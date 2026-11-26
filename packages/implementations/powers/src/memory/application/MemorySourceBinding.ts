/** 即时调用的来源绑定：仅从当前 canonical Session 有界读取，不接受模型自造身份或角色。 */
import type { PowerContext, PowerJsonObject, PowerLifecycleContext } from "@downcity/city/power";
import type { MemorySource, MemorySourceSelector } from "../types/MemoryRecord.js";
import { canonical_memory_json, memory_hash } from "../storage/MemoryRecordStore.js";
import { assert_memory_text_safe } from "../runtime/MemorySensitiveText.js";

/** 把已获准捕获文本固化为来源；调用方仅为可信宿主模块。 */
export function capture_memory_source(input: Omit<MemorySource, "source_id" | "content_hash" | "captured_at">, text: string): MemorySource {
  assert_memory_text_safe(text);
  if (input.excerpt !== undefined) assert_memory_text_safe(input.excerpt);
  const content_hash = `sha256:${memory_hash(text)}`;
  return { ...input, source_id: `src_${memory_hash(canonical_memory_json([input.source_type, input.role, input.locator, content_hash]))}`,
    content_hash, captured_at: new Date().toISOString() };
}
/** 每次操作保留真实请求，永不把它标成用户表述。 */
export function memory_request_source(context: PowerContext, payload: unknown): MemorySource {
  const text = canonical_memory_json(payload);
  if (Buffer.byteLength(text, "utf8") > 256_000) throw new Error("SOURCE_BUDGET_EXCEEDED");
  return capture_memory_source({ source_type: "request", role: "request", excerpt: text, locator: {
    agent_id: context.agent.id, session_id: context.session?.id, session_type: context.session?.type,
    tool_call_id: context.call?.tool_call_id,
  } }, text);
}
/** canonical text Part 的独立捕获，不拼接不同 Part 伪造原句。 */
function capture_part(context: PowerContext, message: PowerJsonObject, part: PowerJsonObject, excerpt?: string): MemorySource {
  const text = part.type === "text" && typeof part.text === "string" ? part.text
    : part.type === "tool" && typeof part.model_output === "string" && ["completed", "failed"].includes(String(part.state)) ? part.model_output : undefined;
  if (text === undefined || typeof part.part_id !== "string" || typeof message.message_id !== "string") throw new Error("SOURCE_PART_UNAVAILABLE");
  const selected = excerpt ?? text;
  if (!selected || Array.from(selected).length > 12_000) throw new Error("SOURCE_BUDGET_EXCEEDED: select a bounded continuous excerpt");
  const start_offset = text.indexOf(selected);
  if (start_offset < 0) throw new Error("SOURCE_EXCERPT_MISMATCH");
  const meta = message.meta as PowerJsonObject | undefined;
  const actor = meta?.from as PowerJsonObject | undefined;
  // runtime/session 入站也存为 user 顶层消息；只有可信 actor=user 才证明用户身份。
  const role = part.type === "tool" ? "tool" : message.role === "agent" ? "agent" : actor?.kind === "user" ? "user" : "request";
  return capture_memory_source({ source_type: "session_message", role, excerpt: selected, locator: {
    agent_id: context.agent.id, session_type: context.session!.type, session_id: context.session!.id,
    message_id: message.message_id, part_id: part.part_id, field: part.type === "tool" ? "model_output" : "text", start_offset, end_offset: start_offset + selected.length,
  }, ...(excerpt === undefined ? { note: "Captured one complete text Part; not the entire Session" } : { note: "Captured a selected continuous text range" }) }, selected);
}

/** 自动固化当前 turn 的真实用户原文，显式选择器只允许当前 Session。 */
export async function bind_memory_sources(context: PowerContext, payload: unknown, selectors: MemorySourceSelector[] = [], include_current_user = true, host?: PowerLifecycleContext): Promise<MemorySource[]> {
  const sources = [memory_request_source(context, payload)];
  if (!context.session) {
    if (selectors.length) throw new Error("SOURCE_SESSION_REQUIRED");
    return sources;
  }
  // 此受限句柄只返回当前 Session；不会按模型参数打开别的 Agent 或 Session。
  if (!host) throw new Error("SOURCE_HOST_UNAVAILABLE");
  const page = await host.system.read_agent_session_messages({ agent_id: context.agent.id, session_id: context.session.id, type: context.session.type, limit: 100, max_bytes: 256_000 });
  const messages = page.messages as unknown as PowerJsonObject[];
  const by_id = new Map(messages.map((message) => [String(message.message_id), message]));
  for (const selector of selectors) {
    const message = by_id.get(selector.message_id) ?? await host.system.read_agent_session_message({ agent_id: context.agent.id, session_id: context.session.id, type: context.session.type, message_id: selector.message_id, max_bytes: 256_000 });
    if (!message || message.session_id !== context.session.id) throw new Error("SOURCE_MESSAGE_UNAVAILABLE");
    const parts = (Array.isArray(message.parts) ? message.parts : []).filter((part): part is PowerJsonObject => Boolean(part) && typeof part === "object" && !Array.isArray(part));
    if (!selector.part_id && parts.length !== 1) throw new Error("SOURCE_PART_REQUIRED");
    const part = selector.part_id ? parts.find((item) => item.part_id === selector.part_id) : parts[0];
    if (!part) throw new Error("SOURCE_PART_UNAVAILABLE");
    sources.push(capture_part(context, message, part, selector.excerpt));
  }
  if (include_current_user && context.turn?.id) {
    for (const message of messages.filter((message) => message.role === "user" && message.turn_id === context.turn!.id)) {
      const actor = (message.meta as PowerJsonObject | undefined)?.from as PowerJsonObject | undefined;
      if (actor?.kind !== "user") continue;
      for (const part of Array.isArray(message.parts) ? message.parts : []) {
        if (part && typeof part === "object" && !Array.isArray(part) && part.type === "text") sources.push(capture_part(context, message, part));
      }
    }
  }
  const unique = [...new Map(sources.map((source) => [source.source_id, source])).values()];
  const bytes = unique.reduce((total, source) => total + Buffer.byteLength(source.excerpt ?? "", "utf8"), 0);
  if (unique.length > 100 || bytes > 256_000) throw new Error("SOURCE_BUDGET_EXCEEDED");
  return unique;
}
/** 只有已认证管理路由调用，表单正文就是本次直接用户输入。 */
export function management_memory_sources(operation_id: string, payload: unknown): MemorySource[] {
  if (!operation_id) throw new Error("Authenticated operation identity required");
  const text = canonical_memory_json(payload);
  return [capture_memory_source({ source_type: "management_input", role: "user", locator: { operation_id }, excerpt: text }, text)];
}
