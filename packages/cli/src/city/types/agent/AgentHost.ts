/**
 * AgentHost 组合根输入类型。
 *
 * 关键点（中文）：Agent 身份与 Workspace 绑定必须成对传入，宿主不允许从路径推导身份。
 */

import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

/** 创建并启动一个 AgentHost 所需的完整输入。 */
export interface CreateAgentHostInput {
  /** 目标 Agent 的稳定身份与当前 Workspace 绑定。 */
  target: DaemonTarget;

  /** CLI 显式提供的宿主启动选项，优先级高于数据库配置。 */
  options: AgentStartOptions;
}
