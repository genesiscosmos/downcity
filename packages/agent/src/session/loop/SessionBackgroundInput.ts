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
    const actor = host.loop.occupied_by();
    if (!host.loop.is_active() && actor) {
      // 重启恢复的占用仍属于原执行；沿已有恢复入口续行，不重放外部命令。
      await host.loop.prompt_inbox({ actor, request_id: input.request_id, query });
      return "accepted";
    }
    return await host.loop.accept_delegation_result(input.turn_id, input.request_id, query) ? "accepted" : "retry";
  }
  if (!input.resume_after_turn) {
    return await host.completions?.read(host.session_id, input.turn_id) ? "discarded" : "retry";
  }
  const completed = await host.completions?.read(host.session_id, input.turn_id);
  if (!host.is_current()) return "retry";
  if (!completed) return host.loop.is_busy() ? "retry" : "discarded";
  if (completed.status !== "completed" && !input.allow_stopped_turn) return "discarded";
  if (host.loop.is_busy()) return "retry";
  try {
    await host.loop.prompt_inbox({
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
