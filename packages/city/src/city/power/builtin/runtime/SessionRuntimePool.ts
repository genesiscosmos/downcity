/** 有界 Session 引擎池：同 Session FIFO、跨 Session 轮转、空闲淘汰和显式关闭。 */
import { WorkerEngine } from "./engine/WorkerEngine.js";
import type { RuntimeEntry, RuntimeJob } from "./types/Pool.js";

/** 引擎池不理解任何 SDK 业务方法。 */
export class SessionRuntimePool {
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly generations = new Map<string, number>();
  private readonly active = new Map<string, AbortController>();
  private readonly queue: RuntimeJob[] = [];
  private readonly running = new Set<Promise<void>>();
  private closed = false;
  private last_scheduled_key = "";
  private readonly idle_timer = setInterval(() => { void this.reap(); }, 60_000);

  constructor() { this.idle_timer.unref(); }

  /** 排队时只持有闭包，不创建 Worker；全 City 最多四个活动 cell。 */
  async schedule<T>(key: string, run: (entry: RuntimeEntry, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("host_unavailable: runtime closed");
    if (this.queue.length >= 64) throw new Error("runtime_busy: execution queue is full");
    return await new Promise<T>((resolve, reject) => {
      this.queue.push({ key, reject, run: async () => {
        const controller = new AbortController();
        this.active.set(key, controller);
        try {
          let entry = this.entries.get(key);
          if (!entry) {
            entry = { engine: new WorkerEngine(), generation: this.generations.get(key) ?? 1, touched_at: Date.now() };
            this.entries.set(key, entry);
          }
          resolve(await run(entry, controller.signal));
        } catch (error) { reject(error); }
        finally { const entry = this.entries.get(key); if (entry) entry.touched_at = Date.now(); this.active.delete(key); }
      } });
      this.dispatch();
    });
  }

  /** 只调度每个 Session 最早的请求；已结束 Session 归还槽后排到其他等待者之后。 */
  private dispatch(): void {
    if (this.closed) return;
    while (this.running.size < 4) {
      const preferred_index = this.queue.findIndex(job => !this.active.has(job.key) && job.key !== this.last_scheduled_key);
      const index = preferred_index >= 0 ? preferred_index : this.queue.findIndex(job => !this.active.has(job.key));
      if (index < 0) break;
      const job = this.queue.splice(index, 1)[0]!;
      this.last_scheduled_key = job.key;
      const running = job.run();
      this.running.add(running);
      void running.finally(() => { this.running.delete(running); this.dispatch(); void this.reap(); });
    }
  }

  /** 超时、宿主更新和 Session 释放共用回收入口，代次不复用。 */
  async release(key: string): Promise<void> {
    this.active.get(key)?.abort(new Error("execution_cancelled: Session runtime released"));
    for (let index = this.queue.length - 1; index >= 0; index--) if (this.queue[index]!.key === key) this.queue.splice(index, 1)[0]!.reject(new Error("execution_cancelled: Session released"));
    await this.reset(key);
  }

  /** 单次失败只回收引擎；后续已排队 cell 仍按 FIFO 获得新代次。 */
  async reset(key: string): Promise<void> {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    this.generations.set(key, (entry?.generation ?? this.generations.get(key) ?? 1) + 1);
    await entry?.engine.dispose();
  }

  private async reap(): Promise<void> {
    const idle = [...this.entries.entries()].filter(([key]) => !this.active.has(key)).sort((left, right) => left[1].touched_at - right[1].touched_at);
    for (let index = 0; index < idle.length; index++) {
      const [key, entry] = idle[index]!;
      if (idle.length - index > 8 || Date.now() - entry.touched_at > 600_000) await this.release(key);
    }
  }

  async dispose(): Promise<void> {
    this.closed = true;
    clearInterval(this.idle_timer);
    for (const job of this.queue.splice(0)) job.reject(new Error("execution_cancelled: runtime closing"));
    await Promise.all([...this.entries.keys()].map(key => this.release(key)));
    await Promise.allSettled([...this.running]);
  }
}

/** Session 来源是身份的一部分，避免同 ID 不同来源串状态。 */
export function runtime_key(agent_id: string, session_id: string, type: string): string {
  return JSON.stringify([agent_id, type, session_id]);
}
