/**
 * AgentWorkspace 装配参数。
 *
 * AgentWorkspace 只表达 Agent 已进入某个 Workspace，不拥有 Agent 身份或 Plugin
 * 定义。Workspace 资源的生命周期在离开时由该作用域统一关闭。
 */

import type { Agent } from "@/agent/Agent.js";
import type { WorkspaceBase } from "@/workspace/WorkspaceBase.js";

/** Agent 进入 Workspace 时使用的内部装配参数。 */
export interface AgentWorkspaceOptions {
  /** 拥有当前作用域的 Agent。 */
  agent: Agent;

  /** 当前进入的项目资源容器。 */
  workspace: WorkspaceBase;
}
