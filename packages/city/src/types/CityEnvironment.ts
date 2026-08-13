/**
 * City 运行环境协议。
 *
 * Environment 把产品配置转换为纯运行时 AgentOptions，不创建或持有 Agent。
 */

import type { AgentOptions } from "@downcity/agent";
import type { CityAgentConfig } from "@/types/CityAgentConfig.js";

/** City 装配 Agent 时使用的平台能力。 */
export interface CityEnvironment {
  /** 将一个产品配置装配成 `new Agent()` 可以直接消费的运行时参数。 */
  create_agent_options(config: CityAgentConfig): Promise<AgentOptions>;

  /** 释放 Environment 自己持有的连接等资源。 */
  dispose?(): Promise<void>;
}
