/**
 * City 持久化适配器协议。
 *
 * Store 只负责向 City 提供装配配置，不创建、返回或接收任何运行时对象。
 */

import type { CityAgentConfig } from "@/types/CityAgentConfig.js";

/** City 使用的持久化适配器。 */
export interface CityStore {
  /** 读取当前产品希望 City 装配的全部 Agent 配置。 */
  load_agent_configs(): Promise<readonly CityAgentConfig[]>;

  /** 释放 Store 自己持有的连接等资源。 */
  dispose(): Promise<void>;
}
