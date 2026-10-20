/**
 * Agent 完成通知的持久化投递运行时。
 *
 * canonical 终态前先保存模型结果与稳定接收方集合，完成后逐接收方独立确认。
 * 回调失败按退避重试；宿主装配完成后 resume 恢复写前记录和未确认投递。外部副作用
 * 与本地确认之间中断仍可能重放，因此必须按 completion_id 幂等。关闭会取消等待，
 * 忽略取消的业务函数不会阻止资源释放。函数和 ToolCallContext 不参与持久化。
 */
import { createHash } from "node:crypto";
import type { EffectHook, JsonValue, SessionTurnCommittedHookValue, ToolCallContext } from "@downcity/type";
import type { SessionCompletionOptions, SessionCompletionRecord } from "@/types/agent/SessionCompletion.js";

/** Agent 唯一的完成通知队列；生命周期跟随 Agent。 */
export class SessionCompletions {
  /** 每条事件最多一个投递操作，避免即时投递和恢复扫描重复执行。 */
  private readonly active = new Map<string, Promise<void>>();
  /** 事件提交过程也纳入关闭等待，防止 Agent 提前释放文件资源。 */
  private readonly submissions = new Set<Promise<void>>();
  /** 可取消的每次投递；停止时唤醒等待者，即使业务函数忽略取消也不阻塞关闭。 */
  private readonly controllers = new Set<AbortController>();
  /** 忽略取消的业务函数结束前不再并发调用同一接收方；关闭不等待它。 */
  private readonly running_handlers = new Set<string>();
  /** 本进程仍在完成 canonical 收口的写前记录，后台扫描不能提前投递。 */
  private readonly preparing = new Set<string>();
  /** 同一时刻只有一个目录扫描。 */
  private scanning?: Promise<void>;
  /** 只有待投递记录存在时保留重试定时器。 */
  private timer?: ReturnType<typeof setTimeout>;
  /** 关闭或解绑后仍可保存终态，但不再调用业务处理器。 */
  private suspended = false;

  constructor(private readonly options: SessionCompletionOptions) {}

  /** 请求提交前校验回调名称，函数不进入持久化输入。 */
  validate_callback(name: string): void {
    if (!name.trim() || !this.handlers().has(`callback:${name}`)) throw new Error(`Unknown Session callback: ${name}`);
  }

  /** canonical 终态前保存权威 Turn 结果；即使没有回调，也用于恢复占用与幂等结果。 */
  async prepare(event: SessionTurnCommittedHookValue, context: ToolCallContext): Promise<void> {
    const handlers = this.handlers();
    const recipient_ids = [...handlers.keys()].filter((id) => !id.startsWith("callback:"));
    for (const message of event.messages) {
      if (message.role !== "user") continue;
      for (const part of message.parts) {
        if (part.type !== "data" || part.data_type !== "session_callback") continue;
        const name = (part.data as { /** 业务回调名称。 */ name: string }).name;
        this.validate_callback(name);
        recipient_ids.push(`callback:${name}\u0000${message.message_id}`);
      }
    }
    const file_path = this.record_path(event.completion_id);
    await this.options.files.ensure_directory("completions");
    await this.options.files.with_file_lock(`${file_path}.lock`, async () => {
      if (await this.options.files.path_exists(file_path)) return;
      await this.save({
        event: structuredClone(event),
        origin: structuredClone(context.session_origin),
        ...(context.workspace ? { workspace_id: context.workspace.id } : {}),
        state: "prepared",
        deliveries: Object.fromEntries(recipient_ids.map((id) => [id, { delivered: false, attempt_count: 0, retry_at: 0 }])),
      });
    });
    this.preparing.add(event.completion_id);
  }

  /** 写前日志是最终执行结果的恢复点，重复 request_id 不再执行模型。 */
  async read(session_id: string, turn_id: string): Promise<SessionTurnCommittedHookValue | undefined> {
    const file_path = this.record_path(`completion:${session_id}:${turn_id}`);
    if (!(await this.options.files.path_exists(file_path))) return undefined;
    return (await this.read_record(file_path)).event;
  }

  /** 先持久化，再启动后台投递；Turn Handle 不等待业务回调完成。 */
  async commit(event: SessionTurnCommittedHookValue, context: ToolCallContext): Promise<void> {
    const operation = this.submit(event, context);
    this.submissions.add(operation);
    try { await operation; } finally {
      this.submissions.delete(operation);
      this.preparing.delete(event.completion_id);
      this.schedule();
    }
  }

  /** 恢复宿主已装配完成的 Agent；只等待扫描，不等待业务回调。 */
  async resume(): Promise<void> {
    this.suspended = false;
    // resume 是宿主重启/显式恢复入口；写前记录的结果已确定，可以恢复投递。
    this.preparing.clear();
    await this.scan();
  }

  /** 关闭回调入口与 Timer；Turn 收口仍会记录未投递事件。 */
  suspend(): void {
    this.suspended = true;
    for (const controller of this.controllers) controller.abort(new Error("Completion delivery suspended"));
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** 宿主停止 Session 后等待所有持久化与在途回调释放。 */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.submissions, ...this.active.values(), ...(this.scanning ? [this.scanning] : [])]);
  }

  /** 原子建立事件；完成日志保留 delivered 状态，重复通知不会再次执行。 */
  private async submit(event: SessionTurnCommittedHookValue, context: ToolCallContext): Promise<void> {
    const file_path = this.record_path(event.completion_id);
    await this.prepare(event, context);
    if (!(await this.options.files.path_exists(file_path))) return;
    const record = await this.options.files.with_file_lock(`${file_path}.lock`, async () => {
      const existing = await this.read_record(file_path);
      if (existing.state !== "prepared") return existing;
      const committed: SessionCompletionRecord = {
        ...existing,
        // 写前结果一旦提交就不受后续日志、压缩或资源释放失败影响。
        event: { ...structuredClone(event), result: existing.event.result, status: existing.event.status },
        state: Object.keys(existing.deliveries).length ? "pending" : "delivered",
      };
      await this.save(committed);
      return committed;
    });
    this.preparing.delete(event.completion_id);
    if (record.state === "pending" && !this.suspended) void this.launch(record, context);
  }

  /** 注册唯一投递操作；失败持久化后由扫描器再次尝试。 */
  private launch(record: SessionCompletionRecord, context?: ToolCallContext): Promise<void> {
    const key = record.event.completion_id;
    const existing = this.active.get(key);
    if (existing) return existing;
    const operation = this.deliver(record, context)
      .catch((error: unknown) => { this.options.report_error(error); })
      .finally(() => {
        this.active.delete(key);
        this.schedule();
      });
    this.active.set(key, operation);
    return operation;
  }

  /** 按稳定接收方分别确认；移除、失败和其它处理器成功互不影响。 */
  private async deliver(record: SessionCompletionRecord, context?: ToolCallContext): Promise<void> {
    if (this.suspended) return;
    const handlers = this.handlers();
    for (const [id, delivery] of Object.entries(record.deliveries)) {
      if (this.suspended) return;
      if (delivery.delivered || delivery.retry_at > Date.now()) continue;
      const [handler_id, message_id] = id.split("\u0000");
      const registered = handlers.get(handler_id!);
      const handler = registered && message_id
        ? Object.assign(async (value: JsonValue, call_context: ToolCallContext) => {
            const event = value as unknown as SessionTurnCommittedHookValue;
            await registered({ ...event, messages: event.messages.filter((message) => message.message_id === message_id) } as unknown as JsonValue, call_context);
          }, { handler_id })
        : registered;
      if (!handler) continue;
      const key = `${record.event.completion_id}:${id}`;
      if (this.running_handlers.has(key)) continue;
      try {
        await this.call_handler(key, handler, record, context);
        if (this.suspended) return;
        delivery.delivered = true;
        delete delivery.error;
      } catch (error) {
        delivery.attempt_count += 1;
        delivery.retry_at = Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(delivery.attempt_count - 1, 6));
        delivery.error = String(error);
        this.options.report_error(error);
      }
      record.state = Object.values(record.deliveries).every((item) => item.delivered) ? "delivered" : "pending";
      // 每个接收方完成即落盘，其它处理器失败不重放已确认的接收方。
      await this.save(record);
    }
  }

  /** 在超时或关闭时结束运行时等待，向业务函数发送取消，不假定函数必定响应。 */
  private async call_handler(
    key: string,
    handler: EffectHook,
    record: SessionCompletionRecord,
    context?: ToolCallContext,
  ): Promise<void> {
    const controller = new AbortController();
    this.controllers.add(controller);
    this.running_handlers.add(key);
    const timeout = setTimeout(() => controller.abort(new Error("Completion callback timed out")), this.options.timeout_ms ?? 30_000);
    const operation = Promise.resolve().then(async () => {
      const call_context = context ?? await this.options.restore_context(record);
      controller.signal.throwIfAborted();
      await handler(structuredClone(record.event) as unknown as JsonValue, { ...call_context, abort_signal: controller.signal });
    }).finally(() => { this.running_handlers.delete(key); });
    let on_abort: () => void = () => {};
    try {
      await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        on_abort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", on_abort, { once: true });
        if (controller.signal.aborted) on_abort();
      })]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", on_abort);
      this.controllers.delete(controller);
    }
  }

  /** 身份由注册方显式提供，禁止把数组位置当成可恢复身份。 */
  private handlers(): Map<string, EffectHook> {
    const handlers = new Map<string, EffectHook>();
    for (const handler of this.options.get_handlers()) {
      const id = handler.handler_id?.trim();
      if (!id) throw new Error("Session completion callback requires a stable handler_id");
      if (handlers.has(id)) throw new Error(`Duplicate completion handler_id: ${id}`);
      handlers.set(id, handler);
    }
    return handlers;
  }

  /** 扫描仅启动到期事件；每条记录单独失败，损坏记录不阻塞其它投递。 */
  private async scan(): Promise<void> {
    if (this.suspended) return;
    if (this.scanning) return await this.scanning;
    this.scanning = (async () => {
      if (!(await this.options.files.path_exists("completions"))) return;
      let pending = false;
      for (const entry of await this.options.files.read_directory("completions")) {
        if (!entry.is_file || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
        try {
          const record = await this.read_record(`completions/${entry.name}`);
          if (record.state === "delivered") continue;
          if (record.state === "prepared" && this.preparing.has(record.event.completion_id)) continue;
          pending = true;
          // prepared 表示执行结果已可靠保存；恢复 Session 后可以重放，无需重跑模型。
          if (!this.suspended && Object.values(record.deliveries).some((delivery) => !delivery.delivered && delivery.retry_at <= Date.now())) {
            void this.launch(record);
          }
        } catch (error) { this.options.report_error(error); }
      }
      if (pending) this.schedule();
    })();
    try { await this.scanning; } finally { this.scanning = undefined; }
  }

  /** 退避扫描不会阻止进程退出；挂起后不会重新创建 Timer。 */
  private schedule(): void {
    if (this.suspended || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.scan().catch((error: unknown) => { this.options.report_error(error); this.schedule(); });
    }, 1_000);
    this.timer.unref?.();
  }

  /** 完成标识只用于哈希路径，不能控制私有目录。 */
  private record_path(completion_id: string): string {
    return `completions/${createHash("sha256").update(completion_id).digest("hex")}.json`;
  }

  /** 读取单条投递记录；异常上报后保留原文件供排查。 */
  private async read_record(file_path: string): Promise<SessionCompletionRecord> {
    const record = JSON.parse((await this.options.files.read_file(file_path)).toString("utf8")) as SessionCompletionRecord;
    if (!record.event?.completion_id || !record.event.session_id || !record.origin?.type || !record.deliveries) {
      throw new Error(`Invalid Session completion record: ${file_path}`);
    }
    return record;
  }

  /** 文件替换提交完整状态，崩溃时保留上次可读版本。 */
  private async save(record: SessionCompletionRecord): Promise<void> {
    await this.options.files.write_file_atomically(this.record_path(record.event.completion_id), JSON.stringify(record));
  }
}
