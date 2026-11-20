/**
 * Session 写操作策略：从可信调用身份校验角色、深度与不可变直接父子关系。
 * 读取不经过此策略；同属一个 Agent 不等于拥有其他会话的控制权。
 */
import { read_session_delegation_depth, resolve_delegation_blocked_reason } from "@downcity/type";
import type { SessionDescriptor } from "@downcity/type";
import type { SessionDelegationCaller } from "@/types/agent/SessionDelegation.js";

/** 创建者可以是 Chat 或任意来源的 Work Main；关系存在时完整校验。 */
export function require_work_creator(caller: SessionDelegationCaller): void {
  const blocked = resolve_delegation_blocked_reason(caller);
  if (blocked) throw new Error(blocked);
  const { parent, parent_session_type, type } = caller;
  if (type === "work" && (parent !== undefined || parent_session_type !== undefined)
    && (!parent?.session_id.trim() || !parent.agent_id.trim() || parent_session_type !== "chat"
      || read_session_delegation_depth(caller) !== 1)) {
    throw new Error("session_relation_invalid: delegated Main must have a complete Chat creator relation");
  }
}

/** 仅允许创建者控制同一 Agent 的直接 Work；业务来源不改变控制关系。 */
export function require_direct_work_child(
  agent_id: string,
  caller: SessionDelegationCaller,
  target: SessionDescriptor & { /** 目标会话标识。 */ id: string; /** 目标所属 Agent。 */ agent_id: string; /** 目标不可变来源。 */ /** 会话的顶层类型。 */

   },
): void {
  require_work_creator(caller);
  if (caller.agent_id !== agent_id || target.agent_id !== agent_id
    || target.type !== "work"
    || target.parent?.session_id !== caller.session_id
    || target.parent_session_type !== caller.type
    || target.parent?.agent_id !== caller.agent_id
    || read_session_delegation_depth(target) !== read_session_delegation_depth(caller) + 1) {
    throw new Error("session_target_forbidden: target must be a directly created Work Session");
  }
}

/** 根据创建记录生成固定来源，追加执行不重新计算关系。 */
export function create_work_descriptor(caller: SessionDelegationCaller): SessionDescriptor {
  return {
    type: "work", kind: "work",
    delegation_depth: read_session_delegation_depth(caller) + 1,
    parent: {
      agent_id: caller.agent_id,
      session_id: caller.session_id,
      turn_id: caller.turn_id,
      call_id: caller.tool_call_id,
    },
    parent_session_type: caller.type,
    ...(caller.type === "chat" ? { root_chat_session_id: caller.session_id }
      : typeof caller.root_chat_session_id === "string"
        ? { root_chat_session_id: caller.root_chat_session_id } : {}),
  };
}
