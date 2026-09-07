/**
 * City 包内运行时访问协议。
 *
 * transport 与 Plugin Runtime 只通过该协议访问 City 的内部索引和作用域创建能力，
 * 避免为了内部协作把生命周期方法暴露到公开 City API。
 */

import type { Agent } from "@downcity/agent";
import type { AgentPluginRuntime } from "@/plugin/types/PluginExecutionRuntime.js";
import type { PluginSnapshot } from "@/plugin/index.js";
import type { WorkspaceRuntime } from "@/workspace/index.js";

/** City 内部组件共享的最小事实源访问面。 */
export interface CityRuntimeAccess {
  /** 按稳定 ID 返回当前可见的 Agent；不存在或正在移除时返回 null。 */
  readonly get_agent: (agent_id: string) => Agent | null;

  /** 返回当前 City 中全部可见 Agent 的稳定快照。 */
  readonly list_agents: () => readonly Agent[];

  /** 按稳定 ID 返回当前可见的 Workspace；不存在或正在移除时返回 null。 */
  readonly get_workspace: (workspace_id: string) => WorkspaceRuntime | null;

  /** 返回当前 City 中全部可见 Workspace 的稳定快照。 */
  readonly list_workspaces: () => readonly WorkspaceRuntime[];

  /** 校验 Agent 与 Workspace 均属于当前 City，并返回 Workspace。 */
  readonly require_workspace: (
    agent_id: string,
    workspace_id: string,
  ) => WorkspaceRuntime;

  /** 按需解析并返回 City 持有的 Workspace。 */
  readonly enter_workspace: (
    agent_id: string,
    workspace_id: string,
  ) => Promise<WorkspaceRuntime>;

  /** 返回指定 Agent/Workspace 的 Plugin 直接调用面。 */
  readonly plugin_scope: (
    agent_id: string,
    workspace_id: string,
  ) => AgentPluginRuntime;

  /** 返回 City 当前全部 Plugin 生命周期快照。 */
  readonly plugin_snapshots: () => PluginSnapshot[];
}
