/**
 * Session Power 的有界历史阅读视图。SDK canonical API 保留完整数据，Power 返回预览与游标。
 * 消息页、Part 页与字段片段分别推进；所有定位仍经当前 Agent 的 SessionWork 权限边界。
 * 字段偏移使用 UTF-16 code unit；JSON 字段只作为序列化文本分段返回。
 */
import { bound_json, json_bytes, HISTORY_PAGE_MAX_BYTES, type SessionWorkContract } from "@downcity/agent";
import type { ModelJsonValue, SessionMessage, SessionMessagePage } from "@downcity/type";
import type { z } from "zod";
import type { session_part_input } from "./SessionSchemas.js";

/** 保留稳定 Part 标识、字段列表、原文长度及有界预览。 */
function part_preview(message: SessionMessage, part: SessionMessage["parts"][number]) {
  const { part_id: _part_id, sequence: _sequence, ...content } = part;
  return {
    part_id: part.part_id, sequence: part.sequence, type: part.type,
    source: { session_id: message.session_id, message_id: message.message_id,
      message_sequence: message.sequence, part_id: part.part_id },
    fields: Object.keys(part), original_bytes: json_bytes(part),
    preview: bound_json(JSON.parse(JSON.stringify(content)) as ModelJsonValue, 1024),
  };
}

/** 消息页优先保留最近消息，因字节预算省略的较早消息仍可用 before 游标访问。 */
export function history_page(page: SessionMessagePage, session_id: string, session_type: string, archived?: boolean) {
  const items = page.items.map(message => ({
    message_id: message.message_id, session_id, sequence: message.sequence, role: message.role,
    created_at: message.created_at, updated_at: message.updated_at,
    ...(message.role === "agent" ? { state: message.state } : {}),
    original_bytes: json_bytes(message), part_count: message.parts.length,
    parts: message.parts.slice(0, 4).map(part => part_preview(message, part)),
    next_after_part_sequence: message.parts.length > 4 ? message.parts[3]!.sequence : null,
    truncated: message.parts.length > 4 || message.parts.some(part => json_bytes(part) > 1024),
  }));
  const result = {
    source: "canonical_history", trust_level: "reference", view: "history_preview", session_id, session_type, archived: archived === true,
    items, total: page.total, start_sequence: items[0]?.sequence, end_sequence: items.at(-1)?.sequence,
    has_more: page.has_more, next_before_sequence: page.next_before_sequence,
    truncated: items.some(item => item.truncated), read_action: "session.part",
  };
  while (json_bytes(result) > HISTORY_PAGE_MAX_BYTES - 128 && items.length > 1) {
    items.shift();
    result.truncated = true;
    result.has_more = true;
    result.start_sequence = items[0]!.sequence;
    result.next_before_sequence = items[0]!.sequence;
  }
  return result;
}

/** 读取指定消息的 Part 页或单个字段；原文从不被预览或递归投影替换。 */
export async function read_history_part(work: SessionWorkContract, input: z.infer<typeof session_part_input>) {
  const page = await work.messages({ session_id: input.session_id, session_type: input.session_type, archived: input.archived,
    before_sequence: input.message_sequence + 1, limit: 1 });
  const message = page.items.find(item => item.message_id === input.message_id && item.sequence === input.message_sequence);
  if (!message) throw new Error("Canonical message not found at the supplied ID and sequence");
  const base = { source: "canonical_history", trust_level: "reference", session_id: input.session_id,
    session_type: input.session_type, archived: input.archived === true, message_id: message.message_id, message_sequence: message.sequence };
  if (!input.part_id) {
    const remaining = message.parts.filter(part => part.sequence > (input.after_part_sequence ?? 0));
    const parts = remaining.slice(0, input.limit ?? 20).map(part => part_preview(message, part));
    return { ...base, view: "part_preview", items: parts, total: message.parts.length,
      has_more: remaining.length > parts.length,
      next_after_part_sequence: remaining.length > parts.length ? parts.at(-1)!.sequence : null };
  }
  const part = message.parts.find(item => item.part_id === input.part_id);
  if (!part) throw new Error("Canonical Part not found in the supplied message");
  const field = input.field!;
  if (!Object.hasOwn(part, field)) throw new Error("Unknown Part field; list Parts to discover available fields");
  const value = (part as unknown as Record<string, unknown>)[field];
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  const offset = input.offset ?? 0;
  if (offset > text.length) throw new Error(`Field offset is out of range (original_characters=${text.length})`);
  let end = Math.min(text.length, offset + (input.length ?? 2048));
  // 正常游标不切开代理对；长度为 1 且遇到 emoji 时允许返回 2 code units，保证推进。
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end += end - offset === 1 ? 1 : -1;
  return { ...base, view: "field_text", part_id: part.part_id, field,
    encoding: typeof value === "string" ? "text" : "json_text", offset, length: end - offset,
    // 复制小片段，避免 V8 substring 保留每次序列化的整份多 MB JSON 缓冲区。
    text: Buffer.from(text.slice(offset, end), "utf16le").toString("utf16le"), original_characters: text.length,
    next_offset: end < text.length ? end : null, end: end === text.length, truncated: end < text.length || offset > 0 };
}
