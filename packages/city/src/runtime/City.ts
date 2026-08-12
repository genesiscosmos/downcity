/**
 * City：一个持久化 Store 下的 Agent 集合。
 *
 * City 统一拥有从 Store 恢复或通过 `add()` 注册的 Agent 实例。它不认识 SQLite、
 * Workspace 路径、模型或 Plugin 的具体配置，只依赖 CityStore 完成持久化与恢复。
 */

import type { Agent } from "@downcity/agent";
import type { CityStore } from "@/types/CityStore.js";
import type { CityState } from "@/types/City.js";

/** 持久化 Agent 的运行时集合。 */
export class City {
  /** 当前 City 持有的 Agent，按稳定 ID 索引。 */
  private readonly agents_by_id = new Map<string, Agent>();

  /** 当前 City 的持久化适配器。 */
  private readonly store: CityStore;

  /** 当前生命周期阶段。 */
  private state: CityState = "idle";

  /** 首次加载产生的稳定 Promise。 */
  private ready_promise?: Promise<void>;

  /** 首次释放产生的稳定 Promise。 */
  private dispose_promise?: Promise<void>;

  constructor(store: CityStore) {
    if (!store) throw new Error("City requires a Store");
    this.store = store;
  }

  /** 从 Store 恢复全部 Agent；恢复失败时释放本次已创建的全部实例。 */
  async ready(): Promise<void> {
    if (this.state === "disposed") throw new Error("Cannot ready a disposed City");
    this.ready_promise ??= this.load_agents();
    await this.ready_promise;
  }

  /** 返回当前 City 持有的 Agent 稳定快照。 */
  agents(): readonly Agent[] {
    this.assert_ready();
    return [...this.agents_by_id.values()];
  }

  /** 按稳定 ID 返回可直接使用的 Agent；不存在时返回 null。 */
  agent(agent_id_input: string): Agent | null {
    this.assert_ready();
    const agent_id = String(agent_id_input || "").trim();
    return this.agents_by_id.get(agent_id) ?? null;
  }

  /** 按稳定 ID 返回 Agent；不存在时抛出明确错误。 */
  require_agent(agent_id_input: string): Agent {
    const agent_id = String(agent_id_input || "").trim();
    const agent = this.agent(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    return agent;
  }

  /** 持久化并注册一个已实例化 Agent。 */
  async add(agent: Agent): Promise<Agent> {
    this.assert_ready();
    if (!agent?.id) throw new Error("City.add requires an Agent");
    if (this.agents_by_id.has(agent.id)) {
      throw new Error(`Agent already exists in City: ${agent.id}`);
    }
    await this.store.save_agent(agent);
    this.agents_by_id.set(agent.id, agent);
    return agent;
  }

  /** 删除持久化注册并释放当前 Agent；Workspace 与 Session 数据保持不变。 */
  async remove(agent_id_input: string): Promise<Agent | null> {
    this.assert_ready();
    const agent_id = String(agent_id_input || "").trim();
    const agent = this.agents_by_id.get(agent_id) ?? null;
    if (!agent) return null;
    await this.store.remove_agent(agent_id);
    this.agents_by_id.delete(agent_id);
    await agent.dispose();
    return agent;
  }

  /** 释放全部运行时实例与 Store，不删除任何持久化配置。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      if (this.ready_promise) await this.ready_promise.catch(() => undefined);
      this.state = "disposed";
      const agents = [...this.agents_by_id.values()];
      this.agents_by_id.clear();
      const results = await Promise.allSettled([
        ...agents.map(async (agent) => await agent.dispose()),
        this.store.dispose(),
      ]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length > 0) throw new AggregateError(errors, "City dispose failed");
    })();
    await this.dispose_promise;
  }

  /** 执行一次完整恢复并提交内存集合。 */
  private async load_agents(): Promise<void> {
    this.state = "loading";
    const restored_agents: readonly Agent[] = await this.store.load_agents();
    const next_agents = new Map<string, Agent>();
    try {
      for (const agent of restored_agents) {
        if (!agent?.id) throw new Error("CityStore restored an invalid Agent");
        if (next_agents.has(agent.id)) {
          throw new Error(`CityStore restored duplicate Agent: ${agent.id}`);
        }
        next_agents.set(agent.id, agent);
      }
    } catch (error) {
      await Promise.allSettled(restored_agents.map(async (agent) => await agent.dispose()));
      this.state = "idle";
      throw error;
    }
    for (const [agent_id, agent] of next_agents) this.agents_by_id.set(agent_id, agent);
    this.state = "ready";
  }

  /** 断言 City 已完成恢复并且尚未释放。 */
  private assert_ready(): void {
    if (this.state === "disposed") throw new Error("City is disposed");
    if (this.state !== "ready") throw new Error("City.ready() must complete first");
  }
}
