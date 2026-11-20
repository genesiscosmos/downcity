/** Session 在工具调用环境中的扁平引用；与工具自身的 type/kind 字段区分。 */
import { normalize_session_descriptor, type SessionDescriptor, type SessionParent, type SessionType } from "./SessionDescriptor.js";

/** 调用方 Session 的已持久化创建事实。 */
export interface SessionCallContext {
  /** 发起调用的 Session 顶层类型。 */
  readonly session_type: SessionType;
  /** 发起调用的 Session 入口用途。 */
  readonly session_kind: string;
  /** 发起调用的 Session 创建者，根会话省略。 */
  readonly session_parent?: SessionParent;
  /** 现有工作调度所需的派生深度。 */
  readonly session_delegation_depth?: number;
  /** 现有创建事实中的父 Session 类型。 */
  readonly session_parent_type?: SessionType;
  /** 现有创建事实中的根 Chat 引用。 */
  readonly session_root_chat_id?: string;
  /** 现有群组成员 Session 的所属群组。 */
  readonly session_group_id?: string;
  /** 现有群组对话的稳定引用。 */
  readonly session_group_session_id?: string;
}

/** 只投影创建字段，避免把 actor、配置或执行对象复制进调用环境。 */
export function session_call_context(input: SessionDescriptor): SessionCallContext {
  const value = normalize_session_descriptor(input);
  return {
    session_type: value.type, session_kind: value.kind,
    ...(value.parent ? { session_parent: value.parent } : {}),
    ...(value.delegation_depth === undefined ? {} : { session_delegation_depth: value.delegation_depth }),
    ...(value.parent_session_type ? { session_parent_type: value.parent_session_type } : {}),
    ...(value.root_chat_session_id ? { session_root_chat_id: value.root_chat_session_id } : {}),
    ...(value.group_id ? { session_group_id: value.group_id } : {}),
    ...(value.group_session_id ? { session_group_session_id: value.group_session_id } : {}),
  };
}

/** 将工具环境中的引用投影回创建字段，复用同一工作调度与关系校验。 */
export function read_session_call_context(input: SessionCallContext): SessionDescriptor {
  return normalize_session_descriptor({
    type: input.session_type, kind: input.session_kind, parent: input.session_parent,
    delegation_depth: input.session_delegation_depth, parent_session_type: input.session_parent_type,
    root_chat_session_id: input.session_root_chat_id, group_id: input.session_group_id,
    group_session_id: input.session_group_session_id,
  });
}
