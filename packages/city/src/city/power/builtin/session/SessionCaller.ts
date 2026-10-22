/**
 * 会话派发的调用身份边界。Session Power 和 Agent delegate 共用真实调用方身份，
 * 禁止模型覆盖回传目标；派发层数达到上限的会话不再继续派发。
 */
import type { SessionOrigin } from "@downcity/type";
import { can_delegate_work, SESSION_DELEGATION_MAX_DEPTH } from "@downcity/type";
import type { PowerContext } from "@/power/index.js";

/** 验证发起来源未超过派发层数上限。 */
export function require_session_coordinator(context: PowerContext): void {
  if (!can_delegate_work(context.session?.origin)) {
    throw new Error(`Session delegation depth limit reached (max ${SESSION_DELEGATION_MAX_DEPTH})`);
  }
}

/** 从运行时生成持久化委派身份，回传始终指向实际发起会话。 */
export function session_delegation_caller(context: PowerContext) {
  require_session_coordinator(context);
  if (!context.session || !context.turn || !context.call.tool_call_id) {
    throw new Error("Session work requires an active Session Turn tool call");
  }
  return { agent_id: context.agent.id, session_id: context.session.id, workspace_id: context.workspace?.id,
    origin: context.session.origin as SessionOrigin,
    turn_id: context.turn.id, tool_call_id: context.call.tool_call_id };
}
