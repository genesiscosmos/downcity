/**
 * AgentPluginContext：Plugin 在 Agent 级生命周期中可访问的最小能力。
 *
 * 边界说明（中文）
 * - 该上下文不包含 Workspace，避免 Agent 级资源意外绑定第一个项目。
 * - Plugin 是否需要 Agent 级生命周期，由 Plugin 自己是否实现 start/stop 决定。
 */

import type { Logger } from "@/utils/logger/Logger.js";
import type { PluginAiServices, PluginWebServices } from "@/types/plugin/PluginServices.js";

/** Plugin 的 Agent 级生命周期上下文。 */
export interface AgentPluginContext {
  /** 当前 Agent 的稳定标识。 */
  readonly agent_id: string;

  /** 当前 Agent 的全局日志器，不绑定任何 Workspace 文件系统。 */
  readonly logger: Logger;

  /** 当前 Agent 持有的用户级 AI 能力。 */
  readonly ai?: PluginAiServices;

  /** 当前 Agent 持有的 Web 搜索与文档能力。 */
  readonly web?: PluginWebServices;

  /** 动态读取当前 Agent 静态指令的只读快照。 */
  readonly instructions: readonly string[];
}
