/**
 * 可信后台输入接收：复用 Session FIFO、canonical 幂等身份和占用仲裁。
 * 原执行仍活动时注入；原执行已收口时仅按明确策略启动后续处理，不冒用用户身份。
 */
import { resolve_prompt_request_identity } from "./SessionTurnHandles.js";
import { read_prompt_input } from "./SessionInputFacts.js";
import { SessionBusyError } from "../SessionBusyError.js";
import type { SessionBackgroundHost, SessionBackgroundInput, SessionBackgroundReceipt } from "@/types/session/SessionBackgroundInput.js";
import type { SessionLoop } from "./SessionLoop.js";

/** 同一 Loop 的在途接收共享确认；只保存 Promise，不维护第二份输入队列。 */
const pending_inputs = new WeakMap<SessionLoop, Map<string, {
  /** 首次登记的原始执行标识，禁止同键跨执行复用。 */
  turn_id: string;
  /** 同键并发接收共享的持久化确认。 */
  receipt: Promise<SessionBackgroundReceipt>;
}>>();

/** 接收确认仅等待输入持久化，不等待模型完成后续工作。 */
export async function accept_background_input(host: SessionBackgroundHost, input: SessionBackgroundInput): Promise<SessionBackgroundReceipt> {
  let pending = pending_inputs.get(host.loop);
  if (!pending) { pending = new Map(); pending_inputs.set(host.loop, pending); }
  const existing = pending.get(input.request_id);
  if (existing) {
    if (existing.turn_id !== input.turn_id) throw new Error("Background request belongs to another Turn");
    return await existing.receipt;
  }
  const operation = receive_background_input(host, input);
  pending.set(input.request_id, { turn_id: input.turn_id, receipt: operation });
  try { return await operation; } finally { pending.delete(input.request_id); }
}

/** 每个稳定请求同时只有一次占用检查与 canonical 接收。 */
async function receive_background_input(host: SessionBackgroundHost, input: SessionBackgroundInput): Promise<SessionBackgroundReceipt> {
  const identity = resolve_prompt_request_identity(host.session_id, input.request_id);
  if (!identity || !input.turn_id.trim()) throw new Error("Background input requires Turn and request identities");
  const previous = await read_prompt_input(host.messages, identity);
  if (previous) {
    if ("role" in previous.input) throw new Error("Background request identity belongs to another input");
    if (previous.input.source?.turn_id !== input.turn_id) throw new Error("Background request belongs to another Turn");
    return "accepted";
  }
  if (!host.is_current()) return "retry";
  const query = [
    { type: "context" as const, tag: "background_source", context: JSON.stringify({ caller_turn_id: input.turn_id }) },
    ...(typeof input.query === "string" ? [{ type: "text" as const, text: input.query }] : input.query),
  ];
  if (host.loop.current_turn_id() === input.turn_id) {
    // 同一 Turn 仍在运行时必须校验执行代次，避免旧 Child 结果注入新的执行。
    if (input.execution_id && host.loop.current_execution_id() !== input.execution_id) return "discarded";
    const actor = host.loop.occupied_by();
    if (!host.loop.is_active() && actor) {
      // 重启恢复的占用仍属于原执行；沿已有恢复入口续行，不重放外部命令。
      await host.loop.prompt_input({ actor, request_id: input.request_id, query });
      return "accepted";
    }
    return await host.loop.accept_delegation_result(input.turn_id, input.request_id, query, input.execution_id) ? "accepted" : "retry";
  }
  if (!input.resume_after_turn) {
    return await host.completions?.read(host.session_id, input.turn_id) ? "discarded" : "retry";
  }
  const completed = await host.completions?.read(host.session_id, input.turn_id);
  if (!host.is_current()) return "retry";
  if (!completed) return host.loop.has_live_execution() ? "retry" : "discarded";
  if (completed.status !== "completed" && !input.allow_stopped_turn) return "discarded";
  if (host.loop.has_live_execution()) {
    const active_turn_id = host.loop.current_turn_id();
    if (!active_turn_id) return "retry";
    // 后续 Turn 正在处理其他结果时直接入队，来源仍绑定最初发起委派的 Turn。
    return await host.loop.accept_delegation_result(active_turn_id, input.request_id, input.query,
      host.loop.current_execution_id(), input.turn_id) ? "accepted" : "retry";
  }
  try {
    await host.loop.prompt_input({
      actor: { kind: "runtime", namespace: "session_background", object_id: input.request_id },
      request_id: input.request_id,
      query,
    });
    return "accepted";
  } catch (error) {
    if (error instanceof SessionBusyError || !host.is_current()) return "retry";
    throw error;
  }
}
