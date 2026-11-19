/**
 * 委派失败的关联边界。
 *
 * 只携带父子 Session/Turn 和固定阶段；原始异常保留在 cause，日志独立做白名单投影。
 * 不复制 query、标题、结果或任何宿主资源，不改变委派状态及重试策略。
 */
import { SessionFailure } from "@/session/SessionFailure.js";
import type { SessionDelegationFailureContext, SessionDelegationRecord } from "@/types/agent/SessionDelegation.js";

/** 将阶段和父子关联附在原始失败之上，不替换其异常链。 */
export class SessionDelegationFailure extends SessionFailure {
  /** 可直接写日志的父子身份与阶段，不含业务内容。 */
  readonly context: SessionDelegationFailureContext;

  constructor(phase: SessionDelegationFailureContext["phase"], cause: unknown, record?: SessionDelegationRecord) {
    super(phase, cause);
    this.context = delegation_failure_context(phase, record);
  }
}

/** 从权威委派记录投影日志关联字段；读取记录失败时只保留阶段。 */
export function delegation_failure_context(
  phase: SessionDelegationFailureContext["phase"], record?: SessionDelegationRecord,
): SessionDelegationFailureContext {
  return { phase, ...(record ? {
    parent_agent_id: record.caller.agent_id, parent_session_id: record.caller.session_id,
    parent_turn_id: record.caller.turn_id, work_session_id: record.work_session_id,
    work_turn_id: record.work_turn_id,
  } : {}) };
}
