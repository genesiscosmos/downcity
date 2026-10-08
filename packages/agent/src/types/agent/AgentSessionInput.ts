/**
 * 取用 Agent 自己那条会话时的可选参数。
 *
 * 关键点（中文）
 * - Agent 自己那条会话就是普通 Session，因此这里的语义与创建普通 Session 一致。
 * - 已经存在时该参数被忽略：换目录走 `session.set({ workspace })`，避免静默切目录。
 */

import type { WorkspaceRuntime } from "@downcity/type";

/** 取用 Agent 自己那条会话的输入。 */
export interface AgentSessionInput {
  /** 首次创建时注入的 Workspace 实例；省略时该会话没有项目上下文。 */
  workspace?: WorkspaceRuntime;
}
