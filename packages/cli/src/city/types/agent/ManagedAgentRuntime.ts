/**
 * ManagedAgentRuntime 组合根输入类型。
 *
 * 关键点（中文）：Agent 身份与运行路径必须成对传入，Runtime 不允许从路径推导身份。
 */

import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

/** 创建并启动一个受管 Agent Runtime 所需的完整输入。 */
export interface CreateManagedAgentRuntimeInput {
  /** 目标 Agent 的稳定身份与其持久化绑定的 Workspace。 */
  target: DaemonTarget;

  /** CLI 显式提供的宿主启动选项，优先级高于数据库配置。 */
  options: AgentStartOptions;
}
