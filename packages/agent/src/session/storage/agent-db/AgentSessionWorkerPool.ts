/**
 * 按需分配的 Agent 文件存储 Worker 池。
 *
 * Writer 池固定 4 个路由槽、Reader 池 2 个独立槽。写调度由共享调度器承担；Reader
 * 以请求数和序列化字节拒绝过载。失联线程先隔离并等待终止，再允许重建，绝不自动
 * 重放已经派发的事务；调用方查询 operation receipt 确认未知提交结果。
 */
import { Worker } from "node:worker_threads";
import { AgentSessionStorageError } from "./AgentSessionErrors.js";
import { DEFAULT_AGENT_STORAGE_BUDGETS } from "./AgentStorageScheduler.js";
import type { AgentSessionWorkerRequest, AgentSessionWorkerResponse, AgentSessionWorkerSlot } from "@/types/store/AgentSessionWorker.js";

/** 等待旧线程退出属于未派发等待；IPC 的 60 秒预算从真正派发开始。 */
const slot_wait_timeout_ms = DEFAULT_AGENT_STORAGE_BUDGETS.queue_timeout_ms;

/** 文件存储线程池，不支持 :memory:，不持有任何执行 Agent。 */
export class AgentSessionWorkerPool {
  private readonly slots = new Map<number, AgentSessionWorkerSlot>();
  private readonly close_waiters = new Set<() => void>();
  private next_id = 0;
  private next_reader = 0;
  private request_count = 0;
  private request_bytes = 0;
  private disposed = false;

  constructor(private readonly readonly: boolean) {}

  /** 预算覆盖槽位等待与 IPC；独立读池限制为 128/32MiB，写池沿用调度器全局上限。 */
  execute(payload: string): Promise<string> {
    if (this.disposed) return Promise.reject(new Error("session_storage_closed"));
    let request: AgentSessionWorkerRequest;
    try { request = JSON.parse(payload) as AgentSessionWorkerRequest; }
    catch { return Promise.reject(new Error("session_storage_request_invalid")); }
    if (request.readonly !== this.readonly || request.database_path === ":memory:") {
      return Promise.reject(new Error("session_storage_worker_target_invalid"));
    }
    const bytes = Buffer.byteLength(payload);
    const count_limit = this.readonly ? 128 : DEFAULT_AGENT_STORAGE_BUDGETS.global_requests;
    const byte_limit = this.readonly ? 32 * 1024 * 1024 : DEFAULT_AGENT_STORAGE_BUDGETS.global_bytes;
    if (this.request_count >= count_limit || this.request_bytes + bytes > byte_limit) {
      return Promise.reject(new Error("session_storage_backpressure"));
    }
    const index = this.readonly ? this.next_reader++ % 2 : this.writer_index(request.database_path);
    this.request_count += 1; this.request_bytes += bytes;
    return this.execute_reserved(index, request).finally(() => {
      this.request_count -= 1; this.request_bytes -= bytes;
    });
  }

  /** 确认所有已隔离线程终止后才可用 receipt 缺失证明未提交，不发起任何重放。 */
  async settle_failed_workers(): Promise<void> {
    await Promise.all([...this.slots.values()].map(slot => slot.termination));
  }

  /** 上层先 drain；池拒绝带在途请求直接关闭，避免伪成功。 */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const finish of this.close_waiters) finish();
    if (this.request_count) throw new Error("session_storage_drain_required");
    await Promise.all([...this.slots].map(([index, slot]) => this.retire_slot(index, slot, "dispose")));
  }

  /** 尚未派发的请求只等待槽位，不重放任何已经交给 Worker 的命令。 */
  private async execute_reserved(index: number, request: AgentSessionWorkerRequest): Promise<string> {
    const deadline = performance.now() + slot_wait_timeout_ms;
    let slot: AgentSessionWorkerSlot;
    while (true) {
      if (this.disposed) throw new Error("session_storage_closed");
      slot = this.slots.get(index) ?? this.create_slot(index);
      if (slot.state === "ready") break;
      await this.wait_for_termination(slot, deadline);
      // 休眠恢复后 Promise 与 Timer 的回调顺序不能让请求越过等待期限。
      if (performance.now() >= deadline) throw new Error("session_storage_queue_timeout");
    }
    clearTimeout(slot.idle_timer);
    slot.worker.ref();
    request.request_id = ++this.next_id;
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { void this.retire_slot(index, slot, "ipc_timeout"); }, 60_000);
      slot.pending.set(request.request_id, { command: request.operation.command, resolve, reject, timer });
      try { slot.worker.postMessage(request); }
      catch { void this.retire_slot(index, slot, "post_message_failed"); }
    });
  }

  /** 每个等待项都有时限和关闭信号；超时只拒绝未派发请求，不影响旧线程退出。 */
  private wait_for_termination(slot: AgentSessionWorkerSlot, deadline: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.close_waiters.delete(on_close);
        slot.termination_waiters.delete(finish);
        if (error) reject(error); else resolve();
      };
      const on_close = () => finish(new Error("session_storage_closed"));
      const timer = setTimeout(() => finish(new Error("session_storage_queue_timeout")), Math.max(0, deadline - performance.now()));
      this.close_waiters.add(on_close);
      slot.termination_waiters.add(finish);
      if (slot.termination_error) finish(slot.termination_error);
      else if (this.disposed) on_close();
    });
  }

  /** 同 Agent 永久命中同槽，直到旧线程已结束才能使用新的连接。 */
  private writer_index(agent_id: string): number {
    let hash = 2166136261;
    for (const byte of Buffer.from(agent_id)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash % 4;
  }

  private create_slot(index: number): AgentSessionWorkerSlot {
    const worker = new Worker(new URL("./AgentSessionWorker.js", import.meta.url));
    const slot: AgentSessionWorkerSlot = { worker, pending: new Map(), state: "ready", termination_waiters: new Set() };
    this.log_lifecycle(index, slot, "created");
    this.slots.set(index, slot);
    worker.on("message", (response: AgentSessionWorkerResponse) => {
      const pending = slot.pending.get(response.request_id);
      if (!pending) return;
      slot.pending.delete(response.request_id); clearTimeout(pending.timer);
      if (response.error_code) pending.reject(new AgentSessionStorageError(pending.command, {
        code: response.error_code, sqlite_code: response.sqlite_code,
      }));
      else if (typeof response.result === "string") pending.resolve(response.result);
      else {
        pending.reject(new Error(this.readonly ? "session_storage_read_failed" : "session_storage_outcome_unknown"));
        void this.retire_slot(index, slot, "invalid_response");
      }
      if (!slot.pending.size && slot.state === "ready") this.idle_slot(index, slot);
    });
    worker.on("error", () => { void this.retire_slot(index, slot, "worker_error"); });
    worker.on("exit", (code) => {
      if (slot.state === "ready") void this.retire_slot(index, slot, "unexpected_exit", code);
    });
    worker.unref();
    return slot;
  }

  /** 无在途请求后按有限空闲时间释放线程，空闲 Agent 不永久占一个 Worker。 */
  private idle_slot(index: number, slot: AgentSessionWorkerSlot): void {
    slot.worker.unref();
    slot.idle_timer = setTimeout(() => {
      if (slot.pending.size || slot.state !== "ready") return;
      void this.retire_slot(index, slot, "idle");
    }, 60_000);
    slot.idle_timer.unref();
  }

  /**
   * 隔离、结算和终止统一收口；每代线程只有一个完成信号。
   * 终止失败保留隔离槽，receipt 核对也必须失败，不能把旧写者仍存活误判为未提交。
   */
  private retire_slot(index: number, slot: AgentSessionWorkerSlot, reason: string, exit_code?: number): Promise<void> {
    if (slot.termination) return slot.termination;
    slot.state = "terminating";
    clearTimeout(slot.idle_timer);
    const started_at = performance.now();
    this.log_lifecycle(index, slot, "terminating", reason, exit_code);
    for (const pending of slot.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(this.readonly ? "session_storage_read_failed" : "session_storage_outcome_unknown"));
    }
    slot.pending.clear();
    // 先发布唯一信号再调用 terminate，避免 error/exit 事件重入重复终止。
    slot.termination = Promise.resolve().then(() => exit_code ?? slot.worker.terminate()).then((code) => {
      slot.state = "terminated";
      if (this.slots.get(index) === slot) this.slots.delete(index);
      this.log_lifecycle(index, slot, "terminated", reason, code, performance.now() - started_at);
      for (const finish of slot.termination_waiters) finish();
    }, () => {
      slot.termination_error = new Error("session_storage_worker_unavailable");
      this.log_lifecycle(index, slot, "termination_failed", reason, undefined, performance.now() - started_at);
      for (const finish of slot.termination_waiters) finish(slot.termination_error);
      throw slot.termination_error;
    });
    // 空闲回收没有调用方；保留原拒绝供等待、关闭和 receipt 路径读取。
    void slot.termination.catch(() => {});
    return slot.termination;
  }

  /** 进程共享池不绑定某个 Agent；诊断只记录生命周期，不输出目标路径或请求正文。 */
  private log_lifecycle(index: number, slot: AgentSessionWorkerSlot, event: string, reason?: string, exit_code?: number, duration_ms?: number): void {
    try {
      console.info("[session.storage.worker]", JSON.stringify({
        timestamp: new Date().toISOString(), pool: this.readonly ? "reader" : "writer",
        slot: index, event, reason, pending_count: slot.pending.size, exit_code, duration_ms,
      }));
    } catch { /* 诊断输出不能改变事务或线程生命周期。 */ }
  }
}
