/** Turn 句柄、延迟结果及 Prompt 幂等身份的纯构造函数，不持有调度状态。 */
import { createHash } from "node:crypto";
import type { SessionAgentMessage } from "@downcity/type";
import type { AgentSessionTurnHandle, AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";
import type { ActiveSessionTurnState, SessionDeferred, PromptRequestIdentity } from "@/types/session/SessionLoop.js";
import { extract_session_message_text } from "@/session/messages/SessionMessageText.js";

/** 分离输入接受与 Turn 完成的 Promise。 */
export function create_deferred<T>(): SessionDeferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

/** 建立尚未接受首条输入的 Turn。 */
export function create_active_session_turn_state(turn_id: string): ActiveSessionTurnState {
  return { turn_id, result: null, deferred_finished: create_deferred<AgentSessionTurnResult>(), turn_context: null, prompt_started: false };
}

/** 句柄只观察所属 Turn，不跟随 Session 后续 Turn。 */
export function create_turn_handle(active_turn: ActiveSessionTurnState): AgentSessionTurnHandle {
  return { id: active_turn.turn_id, get result() { return active_turn.result; }, finished: active_turn.deferred_finished.promise };
}

/** 将业务键转换成稳定内部标识，避免路径暴露原始业务值。 */
export function resolve_prompt_request_identity(session_id: string, request_id_input: string | undefined): PromptRequestIdentity | null {
  const request_id = String(request_id_input || "").trim();
  if (!request_id) return null;
  if (request_id.length > 512) throw new Error("session.prompt request_id must not exceed 512 characters");
  const digest = createHash("sha256").update(session_id).update("\u0000").update(request_id).digest("hex");
  return { message_id: `user-request:${digest}`, turn_id: `turn-request:${digest}` };
}

/** 从完成的 canonical Agent Message 读取结果。 */
export function to_persisted_turn_result(turn_id: string, message: SessionAgentMessage): AgentSessionTurnResult {
  const part = [...message.parts].reverse().find((item) => item.type === "error");
  const error = part?.type === "error" ? part.message : undefined;
  return { turn_id, text: extract_session_message_text(message), success: !error, ...(error ? { error } : {}) };
}

/** 为已持久化结果创建立即完成的句柄。 */
export function create_completed_turn_handle(result: AgentSessionTurnResult): AgentSessionTurnHandle {
  return { id: result.turn_id, result, finished: Promise.resolve(result) };
}
