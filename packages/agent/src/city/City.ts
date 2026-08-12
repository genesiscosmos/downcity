/**
 * City：进程内 Agent 环境容器。
 *
 * City 是宿主进程内 Agent 实例的唯一拥有者。它不持久化 Agent 与 Workspace 的绑定，
 * 也不赋予 Agent 启动或停止状态；CLI、Desktop 等宿主决定何时创建和释放整个 City。
 */

import type { Agent } from "@/agent/Agent.js";
import type {
  CityOptions,
  CityRemoveAgentOptions,
} from "@/types/city/City.js";

/** 进程内 Agent 环境容器。 */
export class City {
  /** 当前 City 持有的 Agent，按稳定 ID 索引。 */
  private readonly agents_by_id = new Map<string, Agent>();

  /** City 首次释放产生的稳定 Promise。 */
  private dispose_promise?: Promise<void>;

  constructor(options: CityOptions | Iterable<Agent> = {}) {
    const agents = Symbol.iterator in Object(options)
      ? options as Iterable<Agent>
      : (options as CityOptions).agents ?? [];
    for (const agent of agents) this.add(agent);
  }

  /** 添加一个已实例化 Agent，并拒绝 ID 冲突。 */
  add(agent: Agent): Agent {
    if (this.dispose_promise) throw new Error("Cannot add Agent to a disposed City");
    if (!agent?.id) throw new Error("City.add requires an Agent");
    if (this.agents_by_id.has(agent.id)) {
      throw new Error(`Agent already exists in City: ${agent.id}`);
    }
    this.agents_by_id.set(agent.id, agent);
    return agent;
  }

  /** 按 ID 读取 Agent；不存在时返回 null。 */
  get(agent_id_input: string): Agent | null {
    const agent_id = String(agent_id_input || "").trim();
    return this.agents_by_id.get(agent_id) ?? null;
  }

  /** 按 ID 读取 Agent；不存在时抛出明确错误。 */
  require(agent_id_input: string): Agent {
    const agent_id = String(agent_id_input || "").trim();
    const agent = this.get(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    return agent;
  }

  /** 返回当前 Agent 的稳定快照。 */
  list(): readonly Agent[] {
    return [...this.agents_by_id.values()];
  }

  /** 从 City 移除 Agent，并默认释放其全部资源。 */
  async remove(
    agent_id_input: string,
    options: CityRemoveAgentOptions = {},
  ): Promise<Agent | null> {
    const agent_id = String(agent_id_input || "").trim();
    const agent = this.agents_by_id.get(agent_id) ?? null;
    if (!agent) return null;
    this.agents_by_id.delete(agent_id);
    if (options.dispose !== false) await agent.dispose();
    return agent;
  }

  /** 并行释放全部 Agent；任何失败都会在资源收口后统一抛出。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= (async () => {
      const agents = [...this.agents_by_id.values()];
      this.agents_by_id.clear();
      const results = await Promise.allSettled(
        agents.map(async (agent) => await agent.dispose()),
      );
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length > 0) throw new AggregateError(errors, "City dispose failed");
    })();
    await this.dispose_promise;
  }
}
