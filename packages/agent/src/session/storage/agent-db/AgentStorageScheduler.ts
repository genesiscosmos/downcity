/**
 * 有界的 Agent/Session 两级公平写入调度。
 *
 * 同 Agent 永远只派发一项，同 Session FIFO；两个层级均按 Map 插入顺序轮转。
 * 预算覆盖等待和运行项，派发后取消不假装回滚。此对象只负责受理与公平性，
 * SQLite 和 IPC 的执行超时、幂等 receipt 由执行能力负责。
 */
import type {
  AgentStorageAgentQueue, AgentStorageBudgets, AgentStorageQueueEntry,
  AgentStorageQueueScope, AgentStorageQueueStats, AgentStorageRequest,
  AgentStorageSchedulerOptions, AgentStorageTiming,
} from "@/types/store/AgentStorageScheduler.js";

/** 与 P0 实施记录一致的有限首版预算。 */
export const DEFAULT_AGENT_STORAGE_BUDGETS: Readonly<AgentStorageBudgets> = Object.freeze({
  global_requests: 4096, global_bytes: 128 * 1024 * 1024,
  agent_requests: 512, agent_bytes: 32 * 1024 * 1024,
  session_requests: 128, session_bytes: 16 * 1024 * 1024,
  request_bytes: 16 * 1024 * 1024, concurrency: 4,
  queue_timeout_ms: 30_000, drain_timeout_ms: 30_000,
});

/** 统一管理请求受理、跨 Agent/Session 公平性与有界排空。 */
export class AgentStorageScheduler {
  private readonly budgets: Readonly<AgentStorageBudgets>;
  private readonly agents = new Map<string, AgentStorageAgentQueue>();
  private readonly entries = new Set<AgentStorageQueueEntry>();
  private readonly drain_waiters = new Set<() => void>();
  private accepting = true;
  private pumping = false;
  private running = 0;
  private requests = 0;
  private bytes = 0;
  private peak_requests = 0;
  private peak_bytes = 0;

  constructor(private readonly options: AgentStorageSchedulerOptions) {
    this.budgets = Object.freeze({ ...DEFAULT_AGENT_STORAGE_BUDGETS, ...options.budgets });
    for (const value of Object.values(this.budgets)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("session_storage_budget_invalid");
    }
  }

  /** 预算满足才接受；JSON 字符串保持原样进入 Worker，不能静默截断或丢弃。 */
  submit(request: AgentStorageRequest): Promise<string> {
    if (!this.accepting) return Promise.reject(new Error("session_storage_closed"));
    if (!request.agent_id || !request.session_id || typeof request.payload !== "string") {
      return Promise.reject(new Error("session_storage_request_invalid"));
    }
    if (request.signal?.aborted) return Promise.reject(new Error("session_storage_cancelled"));
    const bytes = Buffer.byteLength(request.payload, "utf8");
    const existing = this.agents.get(request.agent_id);
    const scope = existing?.scopes.get(request.session_id);
    if (bytes > this.budgets.request_bytes
      || this.exceeds({ requests: this.requests, bytes: this.bytes }, bytes, this.budgets.global_requests, this.budgets.global_bytes)
      || this.exceeds(existing, bytes, this.budgets.agent_requests, this.budgets.agent_bytes)
      || this.exceeds(scope, bytes, this.budgets.session_requests, this.budgets.session_bytes)) {
      return Promise.reject(new Error("session_storage_backpressure"));
    }
    // 字符串长度预算先检查，避免对超限正文执行额外 JSON 分配。
    try { JSON.parse(request.payload); } catch { return Promise.reject(new Error("session_storage_request_invalid")); }
    return new Promise<string>((resolve, reject) => {
      const entry: AgentStorageQueueEntry = {
        request: { ...request }, bytes, accepted_at: performance.now(),
        dispatched: false, settled: false, cleanup: () => {}, resolve, reject,
      };
      const agent = existing ?? { requests: 0, bytes: 0, running: false, sessions: new Map(), scopes: new Map() };
      const session = scope ?? { requests: 0, bytes: 0 };
      this.agents.set(request.agent_id, agent);
      agent.scopes.set(request.session_id, session);
      const queue = agent.sessions.get(request.session_id) ?? [];
      queue.push(entry);
      agent.sessions.set(request.session_id, queue);
      this.charge(agent, session, bytes, 1);
      this.entries.add(entry);
      const cancel = () => this.cancel_queued(entry, "session_storage_cancelled");
      const timeout = setTimeout(() => this.cancel_queued(entry, "session_storage_queue_timeout"), this.budgets.queue_timeout_ms);
      request.signal?.addEventListener("abort", cancel, { once: true });
      entry.cleanup = () => {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", cancel);
      };
      // 从检查到 listener 注册之间已经取消时仍必须拒绝，不能遗留计费项。
      if (request.signal?.aborted) cancel();
      this.pump();
    });
  }

  /** 精确返回当前已计费数量和字节，包括运行项。 */
  stats(): AgentStorageQueueStats {
    let oldest_at = performance.now();
    for (const entry of this.entries) oldest_at = Math.min(oldest_at, entry.accepted_at);
    return {
      requests: this.requests, bytes: this.bytes, running: this.running,
      peak_requests: this.peak_requests, peak_bytes: this.peak_bytes,
      oldest_age_ms: this.entries.size ? performance.now() - oldest_at : 0,
    };
  }

  /** 等待所有已接受请求结算，超时不取消在途事务或报告已回滚。 */
  async flush(): Promise<void> {
    if (!this.requests) return;
    await new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); this.drain_waiters.delete(finish); resolve(); };
      const timer = setTimeout(() => {
        this.drain_waiters.delete(finish);
        reject(new Error("session_storage_drain_timeout: accepted operations may still commit"));
      }, this.budgets.drain_timeout_ms);
      this.drain_waiters.add(finish);
    });
  }

  /** 关闭受理入口并排空；拥有者随后才能释放 Worker 和连接。 */
  async dispose(): Promise<void> {
    this.accepting = false;
    await this.flush();
  }

  /** 三层预算共享统一的含运行项计费。 */
  private exceeds(scope: AgentStorageQueueScope | undefined, bytes: number, count_limit: number, byte_limit: number): boolean {
    return (scope?.requests ?? 0) + 1 > count_limit || (scope?.bytes ?? 0) + bytes > byte_limit;
  }

  /** 增减三级预算，Session 与 Agent 的生命周期直到最后一项结算。 */
  private charge(agent: AgentStorageAgentQueue, session: AgentStorageQueueScope, bytes: number, direction: 1 | -1): void {
    this.requests += direction;
    this.bytes += direction * bytes;
    agent.requests += direction;
    agent.bytes += direction * bytes;
    session.requests += direction;
    session.bytes += direction * bytes;
    this.peak_requests = Math.max(this.peak_requests, this.requests);
    this.peak_bytes = Math.max(this.peak_bytes, this.bytes);
  }

  /** 每次取 Agent 和 Session 的队首，重新插到各自轮转队列尾部。 */
  private next_entry(): AgentStorageQueueEntry | undefined {
    for (const [agent_id, agent] of this.agents) {
      if (agent.running || !agent.sessions.size) continue;
      const [session_id, queue] = agent.sessions.entries().next().value!;
      const entry = queue.shift()!;
      agent.sessions.delete(session_id);
      if (queue.length) agent.sessions.set(session_id, queue);
      this.agents.delete(agent_id);
      this.agents.set(agent_id, agent);
      agent.running = true;
      return entry;
    }
    return undefined;
  }

  /** 填充不同 Agent 的可用槽；同步抛错也通过同一结算路径释放预算。 */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.running < this.budgets.concurrency) {
        const entry = this.next_entry();
        if (!entry) break;
        entry.dispatched = true;
        entry.cleanup();
        this.running += 1;
        const dispatched_at = performance.now();
        void Promise.resolve().then(() => {
          entry.request.assert_dispatchable?.();
          return this.options.execute(entry.request.agent_id, entry.request.payload);
        }).then(
          (response) => this.settle(entry, dispatched_at, "completed", response),
          (error: unknown) => this.settle(entry, dispatched_at, "failed", undefined, error),
        );
      }
    } finally { this.pumping = false; }
  }

  /** 仅移除未派发项；运行中请求由 Worker 的最终结果结算。 */
  private cancel_queued(entry: AgentStorageQueueEntry, code: string): void {
    if (entry.dispatched || entry.settled) return;
    const agent = this.agents.get(entry.request.agent_id)!;
    const queue = agent.sessions.get(entry.request.session_id)!;
    queue.splice(queue.indexOf(entry), 1);
    if (!queue.length) agent.sessions.delete(entry.request.session_id);
    this.settle(entry, performance.now(), "cancelled", undefined, new Error(code));
  }

  /** 一个已接受请求只结算一次，观察器不能改变已提交结果。 */
  private settle(entry: AgentStorageQueueEntry, dispatched_at: number, outcome: AgentStorageTiming["outcome"], response?: string, error?: unknown): void {
    if (entry.settled) return;
    entry.settled = true;
    entry.cleanup();
    const agent = this.agents.get(entry.request.agent_id)!;
    const session = agent.scopes.get(entry.request.session_id)!;
    if (entry.dispatched) {
      agent.running = false;
      this.running -= 1;
      // 执行期间新到达的 Agent/Session 应先获得下一轮，不能让早到者连占两轮。
      const pending = agent.sessions.get(entry.request.session_id);
      if (pending) { agent.sessions.delete(entry.request.session_id); agent.sessions.set(entry.request.session_id, pending); }
      this.agents.delete(entry.request.agent_id);
      this.agents.set(entry.request.agent_id, agent);
    }
    this.charge(agent, session, entry.bytes, -1);
    this.entries.delete(entry);
    if (!session.requests) agent.scopes.delete(entry.request.session_id);
    if (!agent.requests) this.agents.delete(entry.request.agent_id);
    const finished_at = performance.now();
    try {
      this.options.observe?.({
        queue_duration_ms: dispatched_at - entry.accepted_at,
        execution_duration_ms: entry.dispatched ? finished_at - dispatched_at : 0,
        duration_ms: finished_at - entry.accepted_at, request_bytes: entry.bytes, outcome,
      });
    } catch { /* 观测器属于宿主边界，不能覆盖真实提交确认。 */ }
    if (outcome === "completed") entry.resolve(response!); else entry.reject(error);
    if (!this.requests) for (const finish of this.drain_waiters) finish();
    this.pump();
  }
}
