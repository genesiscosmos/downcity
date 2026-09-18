/**
 * City 包内运行时访问协议。
 *
 * transport 与 Power Runtime 只通过该协议访问 City 的内部索引和作用域创建能力，
 * 避免为了内部协作把生命周期方法暴露到公开 City API。
 */

import type { Agent } from "@downcity/agent";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
import type { PowerSnapshot } from "@/power/index.js";
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

  /** 返回指定 Agent/Workspace 的 Power 直接调用面。 */
  readonly power_scope: (
    agent_id: string,
    workspace_id: string,
  ) => AgentPowerRuntime;

  /** 返回 City 当前全部 Power 生命周期快照。 */
  readonly power_snapshots: () => PowerSnapshot[];

  /** 调用当前注册 power 的动作；不经过模型工具面。 */
  readonly invoke_power_action: (input: {
    /** 目标 Agent 标识。 */
    agent_id: string;
    /** 目标 Workspace 标识。 */
    workspace_id: string;
    /** 目标 power 标识。 */
    power: string;
    /** 目标动作 id，点号形式。 */
    action: string;
    /** 动作输入。 */
    payload: unknown;
    /** 当前调用所属 Session；非 Session 调用时为空。 */
    session_id?: string | null;
    /** 当前调用所属 Turn；非 Turn 调用时为空。 */
    turn_id?: string | null;
  }) => Promise<unknown>;

  /** 判断某个动作 id 是否登记在当前 City。 */
  readonly has_action: (action_id: string) => boolean;
}
