/**
 * 按需分配的 Agent 文件存储 Worker 池。
 *
 * Writer 池固定 4 个路由槽、Reader 池 2 个独立槽。写调度由共享调度器承担；Reader
 * 以请求数和序列化字节拒绝过载。失联线程先隔离并等待终止，再允许重建，绝不自动
 * 重放已经派发的事务；调用方查询 operation receipt 确认未知提交结果。
 */
import { Worker } from "node:worker_threads";
import { AgentSessionStorageError } from "./AgentSessionErrors.js";
import type { AgentSessionWorkerRequest, AgentSessionWorkerResponse, AgentSessionWorkerSlot } from "@/types/store/AgentSessionWorker.js";

/** 文件存储线程池，不支持 :memory:，不持有任何执行 Agent。 */
export class AgentSessionWorkerPool {
  private readonly slots = new Map<number, AgentSessionWorkerSlot>();
  private readonly closing = new Set<Promise<unknown>>();
  private next_id = 0;
  private next_reader = 0;
  private request_count = 0;
  private request_bytes = 0;
  private disposed = false;

  constructor(private readonly readonly: boolean) {}

  /** 请求正文已经受写预算约束；独立读请求另有 128/32MiB 上限。 */
  execute(payload: string): Promise<string> {
    if (this.disposed) return Promise.reject(new Error("session_storage_closed"));
    let request: AgentSessionWorkerRequest;
    try { request = JSON.parse(payload) as AgentSessionWorkerRequest; }
    catch { return Promise.reject(new Error("session_storage_request_invalid")); }
    if (request.readonly !== this.readonly || request.database_path === ":memory:") {
      return Promise.reject(new Error("session_storage_worker_target_invalid"));
    }
    const bytes = Buffer.byteLength(payload);
    if (this.readonly && (this.request_count >= 128 || this.request_bytes + bytes > 32 * 1024 * 1024)) {
      return Promise.reject(new Error("session_storage_backpressure"));
    }
    const index = this.readonly ? this.next_reader++ % 2 : this.writer_index(request.database_path);
    const slot = this.slots.get(index) ?? this.create_slot(index);
    if (slot.failed) return Promise.reject(new Error("session_storage_worker_unavailable"));
    clearTimeout(slot.idle_timer);
    slot.worker.ref();
    request.request_id = ++this.next_id;
    this.request_count += 1; this.request_bytes += bytes;
    return new Promise<string>((resolve, reject) => {
      const finish = () => { this.request_count -= 1; this.request_bytes -= bytes; };
      const timer = setTimeout(() => this.fail_slot(index, slot), 60_000);
      slot.pending.set(request.request_id, {
        command: request.operation.command,
        resolve: (value) => { finish(); resolve(value); },
        reject: (error) => { finish(); reject(error); }, timer,
      });
      try { slot.worker.postMessage(request); } catch { this.fail_slot(index, slot); }
    });
  }

  /** 确认所有已隔离线程终止后才可用 receipt 缺失证明未提交，不发起任何重放。 */
  async settle_failed_workers(): Promise<void> {
    await Promise.all([...this.closing]);
  }

  /** 上层先 drain；池拒绝带在途请求直接关闭，避免伪成功。 */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.request_count) throw new Error("session_storage_drain_required");
    const terminations: Promise<unknown>[] = [...this.closing];
    for (const [index, slot] of this.slots) {
      clearTimeout(slot.idle_timer); slot.failed = true;
      terminations.push(slot.worker.terminate()); this.slots.delete(index);
    }
    await Promise.all(terminations);
  }

  /** 同 Agent 永久命中同槽，直到旧线程已结束才能使用新的连接。 */
  private writer_index(agent_id: string): number {
    let hash = 2166136261;
    for (const byte of Buffer.from(agent_id)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash % 4;
  }

  private create_slot(index: number): AgentSessionWorkerSlot {
    const worker = new Worker(new URL("./AgentSessionWorker.js", import.meta.url));
    const slot: AgentSessionWorkerSlot = { worker, pending: new Map(), failed: false };
    this.slots.set(index, slot);
    worker.on("message", (response: AgentSessionWorkerResponse) => {
      const pending = slot.pending.get(response.request_id);
      if (!pending) return;
      slot.pending.delete(response.request_id); clearTimeout(pending.timer);
      if (response.error_code) pending.reject(new AgentSessionStorageError(pending.command, {
        code: response.error_code, sqlite_code: response.sqlite_code,
      }));
      else if (typeof response.result === "string") pending.resolve(response.result);
      else { pending.reject(new Error(this.readonly ? "session_storage_read_failed" : "session_storage_outcome_unknown")); this.fail_slot(index, slot); }
      if (!slot.pending.size && !slot.failed) this.idle_slot(index, slot);
    });
    worker.on("error", () => this.fail_slot(index, slot));
    worker.on("exit", () => {
      if (!slot.failed) this.fail_slot(index, slot);
    });
    worker.unref();
    return slot;
  }

  /** 无在途请求后按有限空闲时间释放线程，空闲 Agent 不永久占一个 Worker。 */
  private idle_slot(index: number, slot: AgentSessionWorkerSlot): void {
    slot.worker.unref();
    slot.idle_timer = setTimeout(() => {
      if (slot.pending.size || slot.failed) return;
      slot.failed = true;
      const termination = slot.worker.terminate().finally(() => {
        if (this.slots.get(index) === slot) this.slots.delete(index);
        this.closing.delete(termination);
      });
      this.closing.add(termination);
    }, 60_000);
    slot.idle_timer.unref();
  }

  /** 终止前隔离整槽，所有已派发写结果均为 unknown；不隐式重试任何副作用。 */
  private fail_slot(index: number, slot: AgentSessionWorkerSlot): void {
    if (slot.failed) return;
    slot.failed = true; clearTimeout(slot.idle_timer);
    for (const pending of slot.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(this.readonly ? "session_storage_read_failed" : "session_storage_outcome_unknown"));
    }
    slot.pending.clear();
    const termination = slot.worker.terminate().finally(() => {
      if (this.slots.get(index) === slot) this.slots.delete(index);
      this.closing.delete(termination);
    });
    this.closing.add(termination);
  }
}
