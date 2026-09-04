/**
 * AgentPluginContext：Plugin 在 Agent 级生命周期中可访问的最小能力。
 *
 * 边界说明（中文）
 * - 该上下文不包含 Workspace，避免 Agent 级资源意外绑定第一个项目。
 * - 该上下文不暴露完整 City，只暴露宿主明确注入的 Embassy 能力。
 * - Plugin 是否需要 Agent 级生命周期，由 Plugin 自己是否实现 start/stop 决定。
 */

import type { Logger } from "@downcity/agent/host";
import type { PluginWebServices } from "@/types/plugin/PluginServices.js";
import type { Embassy } from "@downcity/federation";

/** Plugin 的 Agent 级生命周期上下文。 */
export interface AgentPluginContext {
  /** 当前 Agent 的稳定标识。 */
  readonly agent_id: string;

  /** 当前 Agent 的全局日志器，不绑定任何 Workspace 文件系统。 */
  readonly logger: Logger;

  /** 当前 Agent 持有的 Web 搜索与文档能力。 */
  readonly web?: PluginWebServices;

  /** City 注入的 Embassy 能力；Agent 未加入 City 时为空。 */
  readonly embassy?: Embassy;

  /** 动态读取当前 Agent 静态指令的只读快照。 */
  readonly instructions: readonly string[];
}
