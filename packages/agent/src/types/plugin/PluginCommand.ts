/**
 * Plugin 生命周期类型。
 *
 * 关键点（中文）：生命周期只负责启动和停止；所有显式能力调用统一使用 Action。
 */

import type { AgentPluginContext } from "@/types/plugin/AgentPluginContext.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";

/** Plugin 生命周期定义。 */
export interface PluginLifecycle {
  /** Plugin 随 Agent 启动的钩子；不得假设存在 Workspace。 */
  start?(context: AgentPluginContext): Promise<void> | void;
  /** Plugin 随 Agent 停止的钩子。 */
  stop?(context: AgentPluginContext): Promise<void> | void;
  /** Agent 进入一个 Workspace 后启动该项目所需资源的钩子。 */
  enter_workspace?(context: PluginContext): Promise<void> | void;
  /** Agent 离开一个 Workspace 前释放该项目资源的钩子。 */
  leave_workspace?(context: PluginContext): Promise<void> | void;
}
