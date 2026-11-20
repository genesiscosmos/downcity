/** Turn 句柄、延迟结果及 Prompt 幂等身份的纯构造函数，不持有调度状态。 */
import { createHash, randomUUID } from "node:crypto";
import type { AgentSessionTurnHandle, AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";
import type { ActiveSessionTurnState, SessionDeferred, PromptRequestIdentity } from "@/types/session/SessionLoop.js";

/** 分离输入接受与 Turn 完成的 Promise。 */
export function create_deferred<T>(): SessionDeferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

/** 建立尚未接受首条输入的 Turn。 */
export function create_active_session_turn_state(turn_id: string): ActiveSessionTurnState {
  return { turn_id, execution_id: randomUUID(), result: null, deferred_finished: create_deferred<AgentSessionTurnResult>(), turn_context: null, prompt_started: false };
}

/** 句柄只观察所属 Turn，不跟随 Session 后续 Turn。 */
export function create_turn_handle(active_turn: ActiveSessionTurnState): AgentSessionTurnHandle {
  return { id: active_turn.turn_id, get result() { return active_turn.settle_after_release ? null : active_turn.result; }, finished: active_turn.deferred_finished.promise };
}

/** 将业务键转换成稳定内部标识，避免路径暴露原始业务值。 */
export function resolve_prompt_request_identity(session_id: string, request_id_input: string | undefined): PromptRequestIdentity | null {
  const request_id = String(request_id_input || "").trim();
  if (!request_id) return null;
  if (request_id.length > 512) throw new Error("session.prompt request_id must not exceed 512 characters");
  const digest = createHash("sha256").update(session_id).update("\u0000").update(request_id).digest("hex");
  return { message_id: `user-request:${digest}`, input_id: `inbox-request:${digest}`, turn_id: `turn-request:${digest}` };
}

/** 为已持久化结果创建立即完成的句柄。 */
export function create_completed_turn_handle(result: AgentSessionTurnResult): AgentSessionTurnHandle {
  return { id: result.turn_id, result, finished: Promise.resolve(result) };
}

/** 定向 Stop 必须指向当前调用；恢复同 Turn 后只认恢复水位之后的消息检查点。 */
export function assert_session_turn_stop(active: ActiveSessionTurnState | null, observed_id: string | undefined,
  expected_turn_id?: string, expected_message?: import("@downcity/type").SessionMessageCheckpoint): void {
  const resumed = active?.resumed_message;
  if (expected_turn_id && ((observed_id && expected_turn_id !== observed_id) || (resumed && (!expected_message
    || expected_message.message_id !== resumed.message_id || !Number.isSafeInteger(expected_message.revision)
    || expected_message.revision <= resumed.revision)))) {
    throw Object.assign(new Error("Session Turn changed before stop"), { code: "turn_changed" });
  }
}
