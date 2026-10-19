/**
 * Agent 完成通知的持久化投递运行时。
 *
 * Turn 完成先保存事件，再调用当前注册的完成 Hook。回调失败按退避重试；宿主在装配
 * 完成后 resume 恢复待投递记录。回调至少执行一次，成功处理器也可能被重放，因此
 * 外部副作用必须按 completion_id 幂等。函数和 ToolCallContext 不参与持久化。
 */
import { createHash } from "node:crypto";
import type { JsonValue, SessionTurnCommittedHookValue, ToolCallContext } from "@downcity/type";
import type { SessionCompletionOptions, SessionCompletionRecord } from "@/types/agent/SessionCompletion.js";

/** Agent 唯一的完成通知队列；生命周期跟随 Agent。 */
export class SessionCompletions {
  /** 每条事件最多一个投递操作，避免即时投递和恢复扫描重复执行。 */
  private readonly active = new Map<string, Promise<void>>();
  /** 事件提交过程也纳入关闭等待，防止 Agent 提前释放文件资源。 */
  private readonly submissions = new Set<Promise<void>>();
  /** 同一时刻只有一个目录扫描。 */
  private scanning?: Promise<void>;
  /** 只有待投递记录存在时保留重试定时器。 */
  private timer?: ReturnType<typeof setTimeout>;
  /** 关闭或解绑后仍可保存终态，但不再调用业务处理器。 */
  private suspended = false;

  constructor(private readonly options: SessionCompletionOptions) {}

  /** 先持久化，再启动后台投递；Turn Handle 不等待业务回调完成。 */
  async commit(event: SessionTurnCommittedHookValue, context: ToolCallContext): Promise<void> {
    const operation = this.submit(event, context);
    this.submissions.add(operation);
    try { await operation; } finally { this.submissions.delete(operation); }
  }

  /** 恢复宿主已装配完成的 Agent；只等待扫描，不等待业务回调。 */
  async resume(): Promise<void> {
    this.suspended = false;
    await this.scan();
  }

  /** 关闭回调入口与 Timer；Turn 收口仍会记录未投递事件。 */
  suspend(): void {
    this.suspended = true;
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
    await this.options.files.ensure_directory("completions");
    const record = await this.options.files.with_file_lock(`${file_path}.lock`, async () => {
      if (await this.options.files.path_exists(file_path)) return await this.read(file_path);
      const created: SessionCompletionRecord = {
        event: structuredClone(event),
        origin: structuredClone(context.session_origin),
        ...(context.workspace ? { workspace_id: context.workspace.id } : {}),
        state: "pending",
        attempt_count: 0,
        retry_at: 0,
      };
      await this.save(created);
      return created;
    });
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

  /** 全部处理器接受后才确认；失败重放使用同一完成事件和新的取消信号。 */
  private async deliver(record: SessionCompletionRecord, context?: ToolCallContext): Promise<void> {
    if (this.suspended) return;
    try {
      const call_context = context ?? await this.options.restore_context(record);
      const delivery_context = { ...call_context, abort_signal: new AbortController().signal };
      const failures: unknown[] = [];
      for (const handler of this.options.get_handlers()) {
        try { await handler(structuredClone(record.event) as unknown as JsonValue, delivery_context); }
        catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, `Session completion handlers failed: ${failures.map(String).join("; ")}`);
      await this.save({ ...record, state: "delivered", error: undefined });
    } catch (error) {
      const attempt_count = record.attempt_count + 1;
      await this.save({
        ...record,
        attempt_count,
        retry_at: Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attempt_count - 1, 6)),
        error: String(error),
      });
      this.options.report_error(error);
    }
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
          const record = await this.read(`completions/${entry.name}`);
          if (record.state !== "pending") continue;
          pending = true;
          if (record.retry_at <= Date.now() && !this.suspended) void this.launch(record);
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
  private async read(file_path: string): Promise<SessionCompletionRecord> {
    const record = JSON.parse((await this.options.files.read_file(file_path)).toString("utf8")) as SessionCompletionRecord;
    if (!record.event?.completion_id || !record.event.session_id || !record.origin?.type) {
      throw new Error(`Invalid Session completion record: ${file_path}`);
    }
    return record;
  }

  /** 文件替换提交完整状态，崩溃时保留上次可读版本。 */
  private async save(record: SessionCompletionRecord): Promise<void> {
    await this.options.files.write_file_atomically(this.record_path(record.event.completion_id), JSON.stringify(record));
  }
}
