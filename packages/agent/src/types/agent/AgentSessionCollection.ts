/**
 * Agent 面向 SDK 用户的 Session 集合类型。
 *
 * Session 归 Agent 所有；Workspace 只在创建时声明本次执行使用的资源环境。
 */

import type { WorkspaceBase } from "@downcity/workspace";
import type { AgentSession } from "@/types/agent/SessionActor.js";

/** 创建 Agent Session 的公开参数。 */
export interface AgentCreateSessionOptions {
  /** 本次 Session 使用的 Workspace 资源；绑定 City 时必须来自该 City。 */
  workspace: WorkspaceBase;

  /** 可选的稳定 Session 标识；省略时由 SDK 生成。 */
  session_id?: string;
}

/** Agent 公开的 Session 创建入口。 */
export interface AgentSessionCollection {
  /** 在指定 Workspace 中创建一个属于当前 Agent 的 Session。 */
  create(options: AgentCreateSessionOptions): Promise<AgentSession>;
}
