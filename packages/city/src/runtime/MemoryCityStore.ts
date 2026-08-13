/**
 * MemoryCityStore：仅用于当前进程的 City Store Adapter。
 *
 * 它不写入文件或数据库，适合测试、临时 Agent Runtime 和不需要持久化的宿主。
 */

import type { CityStore } from "@/types/CityStore.js";
import type { CityAgentConfig } from "@/types/CityAgentConfig.js";

/** 进程内 Agent Store。 */
export class MemoryCityStore implements CityStore {
  /** 当前 Store 保存的记录快照。 */
  private readonly configs: CityAgentConfig[];

  constructor(configs: Iterable<CityAgentConfig> = []) {
    this.configs = [...configs];
  }

  /** 返回构造时提供的 Agent 装配配置。 */
  async load_agent_configs(): Promise<readonly CityAgentConfig[]> {
    return structuredClone(this.configs);
  }

  /** 内存 Store 不持有外部资源。 */
  async dispose(): Promise<void> {}
}
