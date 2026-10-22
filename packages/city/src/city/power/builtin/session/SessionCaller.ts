/**
 * 会话派发的调用身份边界。Session Power 和 Agent delegate 共用真实调用方身份，
 * 禁止模型覆盖回传目标；不能派发的来源由原因函数统一给出。
 */
import type { SessionOrigin } from "@downcity/type";
import { resolve_delegation_blocked_reason } from "@downcity/type";
import type { PowerContext } from "@/power/index.js";

/** 验证发起来源允许派发。 */
export function require_session_coordinator(context: PowerContext): void {
  const blocked = resolve_delegation_blocked_reason(context.session?.origin);
  if (blocked) throw new Error(blocked);
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
