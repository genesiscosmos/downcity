/**
 * MemoryCityStore：仅用于当前进程的 City Store Adapter。
 *
 * 它不写入文件或数据库，适合测试、临时 Agent Runtime 和不需要持久化的宿主。
 */

import type { Agent } from "@downcity/agent";
import type { CityStore } from "@/types/CityStore.js";

/** 进程内 Agent Store。 */
export class MemoryCityStore implements CityStore {
  /** 当前 Store 保存的 Agent 快照。 */
  private readonly values: Agent[];

  constructor(agents: Iterable<Agent> = []) {
    this.values = [...agents];
  }

  /** 返回当前 Store 保存的 Agent。 */
  async load_agents(): Promise<readonly Agent[]> {
    return [...this.values];
  }

  /** 保存 Agent；内存 Store 只维护实例引用。 */
  async save_agent(agent: Agent): Promise<void> {
    if (!this.values.some((value) => value.id === agent.id)) this.values.push(agent);
  }

  /** 从内存 Store 移除 Agent。 */
  async remove_agent(agent_id: string): Promise<void> {
    const index = this.values.findIndex((agent) => agent.id === agent_id);
    if (index >= 0) this.values.splice(index, 1);
  }

  /** 内存 Store 不持有外部资源。 */
  async dispose(): Promise<void> {}
}
