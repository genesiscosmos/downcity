/**
 * Session 写操作策略：从可信调用身份校验角色、深度与不可变直接父子关系。
 * 读取不经过此策略；同属一个 Agent 不等于拥有其他会话的控制权。
 */
import { read_session_delegation_depth, resolve_delegation_blocked_reason } from "@downcity/type";
import type { SessionOrigin } from "@downcity/type";
import type { SessionDelegationCaller } from "@/types/agent/SessionDelegation.js";

/** 创建者可以是 Chat、用户直接创建的 Work，或 Chat 创建的 Work。 */
export function require_work_creator(caller: SessionDelegationCaller): void {
  const blocked = resolve_delegation_blocked_reason(caller.origin);
  if (blocked) throw new Error(blocked);
  const has_parent = caller.origin.parent_session_id !== undefined
    || caller.origin.parent_session_category !== undefined || caller.origin.parent_agent_id !== undefined;
  if (caller.origin.category === "work" && has_parent
    && (typeof caller.origin.parent_session_id !== "string" || !caller.origin.parent_session_id.trim()
      || caller.origin.parent_session_category !== "chat"
      || caller.origin.root_chat_session_id !== caller.origin.parent_session_id
      || read_session_delegation_depth(caller.origin) !== 1)) {
    throw new Error("session_relation_invalid: Work creator must be a direct child of Chat");
  }
}

/** 仅允许创建者控制同一 Agent 的直接普通 Work 子会话。 */
export function require_direct_work_child(
  agent_id: string,
  caller: SessionDelegationCaller,
  target: { /** 目标会话标识。 */ id: string; /** 目标所属 Agent。 */ agent_id: string; /** 目标不可变来源。 */ origin: SessionOrigin },
): void {
  require_work_creator(caller);
  if (caller.agent_id !== agent_id || target.agent_id !== agent_id
    || target.origin.category !== "work" || target.origin.type !== "work"
    || target.origin.parent_session_id !== caller.session_id
    || target.origin.parent_session_category !== caller.origin.category
    || target.origin.parent_agent_id !== caller.agent_id
    || read_session_delegation_depth(target.origin) !== read_session_delegation_depth(caller.origin) + 1) {
    throw new Error("session_target_forbidden: target must be a directly created Work Session");
  }
}

/** 根据创建记录生成固定来源，追加执行不重新计算关系。 */
export function create_work_origin(caller: SessionDelegationCaller): SessionOrigin {
  return {
    category: "work", type: "work",
    delegation_depth: read_session_delegation_depth(caller.origin) + 1,
    parent_agent_id: caller.agent_id,
    parent_session_id: caller.session_id,
    parent_session_category: caller.origin.category,
    ...(caller.origin.category === "chat" ? { root_chat_session_id: caller.session_id }
      : typeof caller.origin.root_chat_session_id === "string"
        ? { root_chat_session_id: caller.origin.root_chat_session_id } : {}),
  };
}
