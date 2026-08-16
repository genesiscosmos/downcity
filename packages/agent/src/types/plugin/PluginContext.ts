/**
 * PluginContext：Agent 向 Plugin 投影的稳定能力视图。
 *
 * 边界说明（中文）
 * - Plugin 只依赖本接口，不持有 Agent 实例，也不参与 Session 内核编排。
 * - 动态状态通过只读 getter 暴露，保证 Workspace env 与 instruction 始终来自唯一状态源。
 */

import type { AgentSessions } from "@/agent/AgentSessions.js";
import type { AgentPlugins } from "@/types/plugin/PluginRuntime.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { Shell } from "@downcity/shell";

/** Agent 向 Plugin 开放的最小、稳定运行时能力。 */
export interface PluginContext {
  /** 当前 Agent 的稳定标识。 */
  readonly agent_id: string;

  /** 当前 Workspace 的稳定标识。 */
  readonly workspace_id: string;

  /** 当前 Workspace 的绝对根目录。 */
  readonly workspace_path: string;

  /** 当前 AgentWorkspace 内部持久化数据的绝对根路径。 */
  readonly data_path: string;

  /** 当前 Workspace 的统一文件能力。 */
  readonly files: FileSystem;

  /** 当前 AgentWorkspace 私有数据目录的统一文件能力。 */
  readonly data_files: FileSystem;

  /** 当前 Workspace 显式挂载的 Shell；未启用时为空。 */
  readonly shell?: Shell;

  /** 当前 Agent 在当前 Workspace 中使用的统一日志器。 */
  readonly logger: Logger;

  /** 当前 Agent 的 Session 集合入口。 */
  readonly sessions: AgentSessions;

  /** 当前 Agent 唯一的 Plugin 调用与注册入口。 */
  readonly plugins: AgentPlugins;

  /** 当前 Workspace 已配置环境变量的只读快照。 */
  readonly workspace_env: Readonly<Record<string, string>>;

  /** 当前 Agent 已配置静态指令的只读快照。 */
  readonly instructions: readonly string[];
}
