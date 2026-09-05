/**
 * 普通 Tool 一次调用获得的最小执行上下文。
 *
 * 该类型只暴露业务 Tool 需要的调用身份、取消、Workspace 快照和可选
 * Session Interaction，不暴露 SessionTurnContext、消息写入器或 Plugin lease。
 */

import type { SessionInteractionPort } from "@/types/session/SessionInteraction.js";

/** 普通 Tool 所属的 Session 范围。 */
export interface ToolSessionExecutionScope {
  /** 当前 Session 标识。 */
  readonly session_id: string;
  /** 当前 Turn 标识。 */
  readonly turn_id: string;
  /** 当前 Session 的用户交互端口；未启用 Interaction 时为空。 */
  readonly interactions?: SessionInteractionPort;
}

/** 普通 Tool 的单次调用上下文。 */
export interface ToolActionExecutionContext {
  /** 当前 Tool Call 标识。 */
  readonly call_id: string;
  /** 当前 Tool 调用的取消信号。 */
  readonly abort_signal: AbortSignal;
  /** 当前 Tool 所属 Session 范围。 */
  readonly session: ToolSessionExecutionScope;
  /** 当前 Workspace 项目根目录。 */
  readonly workspace_path?: string;
  /** 当前 Step 已提交生效的 Workspace env。 */
  readonly workspace_env?: Readonly<Record<string, string>>;
}
