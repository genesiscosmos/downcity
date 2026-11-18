/**
 * 宿主后台读取的持久化 Turn 投影。
 * 复用 prompt 幂等身份与 canonical 完成结果解释，不依赖进程内 finished Promise。
 */
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";
import type { SessionCompletionPort } from "@/types/agent/SessionCompletion.js";
import { resolve_prompt_request_identity } from "@/session/loop/SessionTurnHandles.js";

/** 一次可恢复的 Turn 状态投影。 */
export interface SessionExecutionReadResult {
  /** 定位出的稳定 Turn ID。 */
  turn_id?: string;
  /** 生命周期状态：running 指原 Turn 未完成，包含当前故障及等待；不用于活动展示。 */
  status: "idle" | "running" | "completed" | "not_found" | "interrupted";
  /** 权威 Turn 完成日志提供的真实结果；单条消息终态不代表 Turn 完成。 */
  result?: AgentSessionTurnResult;
}

/** 按 Turn 或业务请求键读取真实完成状态。 */
export async function read_session_execution(storage: SessionStorage, live_execution: boolean, input: {
  /** 精确 Turn ID，与 request_id 互斥。 */
  turn_id?: string;
  /** prompt 业务请求键，与 turn_id 互斥。 */
  request_id?: string;
}, completions?: SessionCompletionPort): Promise<SessionExecutionReadResult> {
  if (input.turn_id && input.request_id) throw new Error("session_read_invalid: turn_id and request_id are mutually exclusive");
  const identity = resolve_prompt_request_identity(storage.session_id, input.request_id);
  const request = identity ? await storage.read_message(identity.message_id) : null;
  const turn_id = input.turn_id ?? request?.turn_id ?? identity?.turn_id;
  if (identity && !request) return { turn_id, status: "not_found" };
  const message = await storage.read_latest_agent_message(turn_id);
  const resolved_turn_id = turn_id ?? message?.turn_id;
  const completion = resolved_turn_id && completions ? await (identity
    ? completions.read_initial(storage.session_id, resolved_turn_id)
    : completions.read(storage.session_id, resolved_turn_id)) : undefined;
  if (completion) return { turn_id: completion.turn_id, status: "completed", result: { turn_id: completion.turn_id, ...completion.result } };
  if (message || request) return { turn_id: turn_id ?? message?.turn_id, status: live_execution ? "running" : "interrupted" };
  return { ...(turn_id ? { turn_id } : {}), status: turn_id ? "not_found" : live_execution ? "running" : "idle" };
}
