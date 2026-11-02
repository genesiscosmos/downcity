/**
 * Agent 完成通知的持久化投递运行时。
 *
 * canonical 终态前先保存模型结果与稳定接收方集合，完成后逐接收方独立确认。
 * 回调失败按接收方的到期时间重试；只有宿主装配或显式 resume 才扫描历史记录。
 * 运行期间只索引未完成记录的下一次投递时间，不把已确认的消息正文留在重试队列中。
 * 外部副作用与本地确认之间中断仍可能重放，因此必须按 completion_id 幂等。
 * 关闭会取消等待，忽略取消的业务函数不会阻止资源释放。函数和 ToolCallContext 不参与持久化。
 */
import { createHash } from "node:crypto";
import type { EffectHook, JsonValue, SessionTurnCommittedHookValue, ToolCallContext } from "@downcity/type";
import { read_session_message_meta } from "@/session/messages/SessionMessageMeta.js";
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
  /** 未完成记录的下一次读取时间；Infinity 表示等待处理器恢复或正在退出的业务函数。 */
  private readonly pending = new Map<string, number>();
  /** 恢复扫描与到期补读互斥；关闭时等待已经发起的文件操作收口。 */
  private scanning?: Promise<void>;
  /** 只为可推进的未完成记录保留一个最近到期定时器。 */
  private timer?: ReturnType<typeof setTimeout>;
  /** 关闭或解绑后仍可保存终态，但不再调用业务处理器。 */
  private suspended = false;

  constructor(private readonly options: SessionCompletionOptions) {}

  /** 请求提交前校验回调名称，函数不进入持久化输入。 */
  validate_callback(name: string): void {
    if (!name.trim() || !this.handlers().has(`callback:${name}`)) throw new Error(`Unknown Session callback: ${name}`);
  }

  /** 专用执行只保存完成结果，不注册普通 Agent/Power 的对外投递接收方。 */
  result_only_port(): import("@/types/agent/SessionCompletion.js").SessionCompletionPort {
    return {
      validate_callback: () => { throw new Error("execution_profile_immutable: ordinary completion callbacks are forbidden"); },
      prepare: async (event, context) => { await this.prepare(event, context, false); },
      read: async (session_id, turn_id) => await this.read(session_id, turn_id),
    };
  }

  /** canonical 终态前保存权威 Turn 结果；即使没有回调，也用于恢复占用与幂等结果。 */
  async prepare(event: SessionTurnCommittedHookValue, context: ToolCallContext, notify = true): Promise<void> {
    const handlers = notify ? this.handlers() : new Map<string, EffectHook>();
    const recipient_ids = [...handlers.keys()].filter((id) => !id.startsWith("callback:"));
    for (const message of notify ? event.messages : []) {
      if (message.role !== "user") continue;
      const name = (read_session_message_meta(message)?.callback as { /** 业务回调名称。 */ name: string } | undefined)?.name;
      if (!name) continue;
      this.validate_callback(name);
      recipient_ids.push(`callback:${name}\u0000${message.message_id}`);
    }
    const file_path = this.record_path(event.completion_id);
    // 在首次异步操作前声明提交所有权，恢复不能接管刚写盘但尚未完成 canonical 收口的记录。
    this.preparing.add(event.completion_id);
    try {
      await this.options.files.ensure_directory("completions");
      await this.options.files.with_file_lock(`${file_path}.lock`, async () => {
        if (await this.options.files.path_exists(file_path)) return;
        await this.save({
          event: structuredClone(event),
          origin: structuredClone(context.session_origin),
          ...(context.workspace ? { workspace_id: context.workspace.id } : {}),
          state: notify ? "prepared" : "delivered",
          deliveries: Object.fromEntries(recipient_ids.map((id) => [id, { delivered: false, attempt_count: 0, retry_at: 0 }])),
        });
      });
      if (!notify) this.preparing.delete(event.completion_id);
    } catch (error) {
      this.preparing.delete(event.completion_id);
      throw error;
    }
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
    // 显式恢复会重新发现磁盘记录与最新处理器；本进程尚在提交的记录仍由提交者负责。
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.recover();
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

  /** 注册唯一投递操作；持久化失败后由未完成索引安排重新读取。 */
  private launch(record: SessionCompletionRecord, context?: ToolCallContext): Promise<void> {
    const key = record.event.completion_id;
    const existing = this.active.get(key);
    if (existing) return existing;
    const operation = this.deliver(record, context)
      .catch((error: unknown) => {
        // 持久化失败不能使记录从内存重试索引消失，也不能形成零延迟的重试循环。
        this.pending.set(key, Date.now() + 1_000);
        this.options.report_error(error);
      })
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
    // 缺失处理器或尚未到期时也更新唤醒时间，避免反复读取无法推进的记录。
    this.track_pending(record);
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
    }).finally(() => {
      this.running_handlers.delete(key);
      // 超时后仍在运行的业务函数退出，才重新允许读取记录；读取后仍遵守持久化 retry_at。
      const completion_id = record.event.completion_id;
      const retry_at = this.pending.get(completion_id);
      if (retry_at !== undefined) this.pending.set(completion_id, Math.min(retry_at, Date.now()));
      this.schedule();
    });
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

  /** 启动或显式恢复时枚举历史；后续 Timer 只访问内存索引中的到期记录。 */
  private async recover(): Promise<void> {
    if (this.suspended) return;
    // 到期补读在途时，显式恢复仍需等它结束后重新发现磁盘与处理器变化。
    while (this.scanning) await this.scanning;
    if (this.suspended) return;
    this.scanning = (async () => {
      if (!(await this.options.files.path_exists("completions"))) return;
      for (const entry of await this.options.files.read_directory("completions")) {
        if (this.suspended) return;
        if (!entry.is_file || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
        try {
          await this.resume_record(`completions/${entry.name}`);
        } catch (error) { this.options.report_error(error); }
      }
    })();
    try { await this.scanning; } finally {
      this.scanning = undefined;
      this.schedule();
    }
  }

  /** 恢复一条记录；活动提交与投递保持唯一所有权，不被恢复快照覆盖。 */
  private async resume_record(file_path: string): Promise<void> {
    await this.options.files.with_file_lock(`${file_path}.lock`, async () => {
      // 活动记录不参与补读：否则旧快照可能在投递确认后把它重新加入索引。
      const is_owned = () => [...this.preparing, ...this.active.keys()]
        .some((key) => this.record_path(key) === file_path);
      if (this.suspended || is_owned()) return;
      const record = await this.read_record(file_path);
      const key = record.event.completion_id;
      if (this.suspended || this.preparing.has(key) || this.active.has(key)) return;
      if (record.state !== "delivered" && Object.values(record.deliveries).every((delivery) => delivery.delivered)) {
        // 无待确认接收方时直接收口；其余 prepared 保留状态，供恢复上下文修复 canonical 消息。
        record.state = "delivered";
        try { await this.save(record); } catch (error) {
          this.pending.set(key, Date.now() + 1_000);
          throw error;
        }
      }
      if (this.suspended || this.preparing.has(key) || this.active.has(key)) return;
      this.track_pending(record);
      if ((this.pending.get(key) ?? Infinity) <= Date.now()) void this.launch(record);
    });
  }

  /** Timer 只补读到期的未完成记录；损坏或暂时不可读的单条记录独立退避。 */
  private async retry_pending(): Promise<void> {
    if (this.suspended || this.scanning) return;
    this.scanning = (async () => {
      for (const [key, retry_at] of [...this.pending]) {
        if (this.suspended) return;
        if (retry_at > Date.now() || this.preparing.has(key) || this.active.has(key)) continue;
        try {
          await this.resume_record(this.record_path(key));
        } catch (error) {
          this.pending.set(key, Date.now() + 1_000);
          this.options.report_error(error);
        }
      }
    })();
    try { await this.scanning; } finally {
      this.scanning = undefined;
      this.schedule();
    }
  }

  /** 索引仅保存下一次读取时间，不保留消息正文；缺失处理器等待显式恢复。 */
  private track_pending(record: SessionCompletionRecord): void {
    const key = record.event.completion_id;
    if (record.state === "delivered") {
      this.pending.delete(key);
      return;
    }
    const deliveries = Object.entries(record.deliveries);
    let retry_at = deliveries.every(([, delivery]) => delivery.delivered) ? 0 : Infinity;
    const handlers = this.handlers();
    for (const [id, delivery] of deliveries) {
      const handler_id = id.split("\u0000")[0]!;
      if (delivery.delivered || !handlers.has(handler_id) || this.running_handlers.has(`${key}:${id}`)) continue;
      retry_at = Math.min(retry_at, delivery.retry_at);
    }
    this.pending.set(key, retry_at);
  }

  /** 总是按最近到期记录重排唯一 Timer；空队列、活动提交与投递不产生空转。 */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.suspended || this.scanning) return;
    let retry_at = Infinity;
    for (const [key, next_retry_at] of this.pending) {
      if (!this.preparing.has(key) && !this.active.has(key)) retry_at = Math.min(retry_at, next_retry_at);
    }
    if (!Number.isFinite(retry_at)) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.retry_pending().catch((error: unknown) => { this.options.report_error(error); });
    }, Math.max(1, Math.min(2_147_483_647, retry_at - Date.now())));
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
    this.track_pending(record);
  }
}
