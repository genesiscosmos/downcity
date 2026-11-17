/**
 * Agent DB 消息提交的领域不变量校验。
 *
 * 复用 canonical codec 对候选消息做完整往返校验；同时验证消息身份、Part 连续序号、
 * 终态以及稳定前缀，防止只写 changed_parts 后 envelope 与真实前缀不一致。
 */
import { isDeepStrictEqual as is_deep_strict_equal } from "node:util";
import type { SessionMessage } from "@downcity/type";
import type { AgentSessionUpdateMessage } from "@/types/store/AgentSessionMessages.js";
import { decode_session_message, encode_session_message_row, encode_session_part_row } from "../SessionStorageCodec.js";
import { validate_session_stable_prefix } from "../SessionStablePrefix.js";

/** 校验聚合结构并防止 codec 静默丢弃角色不允许的内容。 */
export function validate_agent_db_message(message: SessionMessage, session_id: string): void {
  if (message.session_id !== session_id || !message.message_id || !Number.isSafeInteger(message.sequence)
    || message.sequence < 1 || !Number.isSafeInteger(message.revision) || message.revision < 1) {
    throw new Error("session_message_identity_invalid");
  }
  validate_session_stable_prefix(message);
  const ids = new Set<string>();
  for (const [index, part] of message.parts.entries()) {
    if (!part.part_id || ids.has(part.part_id) || part.sequence !== index + 1) throw new Error("session_part_identity_invalid");
    ids.add(part.part_id);
    if (message.role === "user" && !["text", "context", "file", "data"].includes(part.type)) {
      throw new Error("session_part_role_invalid");
    }
  }
  // codec 负责 Tool/Interaction、Inbox、Power 等内容形状校验，错误不跨 Worker 输出正文。
  decode_session_message(encode_session_message_row(message), message.parts.map((part) => encode_session_part_row(message, part)), session_id);
  if (message.role === "agent" && message.state === "done") {
    const nonterminal = message.parts.some((part) => {
      if (part.type === "text" || part.type === "reasoning") return part.state !== "done";
      if (part.type === "tool" || part.type === "action") return part.state !== "completed" && part.state !== "failed";
      return false;
    });
    if (nonterminal) throw new Error("session_message_done_prefix_invalid");
  }
}

/** 拒绝变更已持久化的消息身份与未声明更新的 Part。 */
export function validate_agent_db_update(current: SessionMessage, input: AgentSessionUpdateMessage): void {
  const next = input.message;
  if (current.revision !== input.expected_revision) throw new Error("session_message_revision_conflict");
  if (next.revision !== input.expected_revision + 1 || current.session_id !== next.session_id
    || current.message_id !== next.message_id || current.sequence !== next.sequence
    || current.role !== next.role || current.created_at !== next.created_at
    || !is_deep_strict_equal(current.origin, next.origin)) throw new Error("session_message_identity_immutable");
  const removed = input.removed_error_part_id ? current.parts.find(part => part.part_id === input.removed_error_part_id) : undefined;
  if (input.removed_error_part_id && (current.role !== "agent" || current.state !== "streaming"
    || !removed || removed.type !== "error" || removed !== current.parts.at(-1) || removed.sequence <= current.stable_part_sequence
    || next.parts.some(part => part.part_id === removed.part_id))) throw new Error("session_error_removal_invalid");
  const retained = removed ? current.parts.slice(0, -1) : current.parts;
  if (next.parts.length < retained.length) throw new Error("session_message_parts_cannot_disappear");
  const current_watermark = current.role === "agent" ? current.stable_part_sequence : 0;
  if (next.role === "agent" && next.stable_part_sequence < current_watermark) throw new Error("session_stable_prefix_backwards");
  const changed = new Map<string, SessionMessage["parts"][number]>(input.changed_parts.map((part) => [part.part_id, part] as const));
  if (changed.size !== input.changed_parts.length) throw new Error("session_changed_parts_invalid");
  for (const [index, part] of next.parts.entries()) {
    const old = retained[index];
    if (old && old.part_id !== part.part_id) throw new Error("session_part_identity_immutable");
    if (old?.type === "tool" && (old.state === "completed" || old.state === "failed")) {
      const { interactions: _old_interactions, ...fixed } = old;
      const { interactions: _next_interactions, ...candidate } = part.type === "tool" ? part : { ...part, interactions: undefined };
      if (!is_deep_strict_equal(fixed, candidate)) throw new Error("tool_terminal_snapshot_immutable");
    }
    const declared = changed.get(part.part_id);
    if (declared && !is_deep_strict_equal(declared, part)) throw new Error("session_changed_parts_invalid");
    if ((!declared || part.sequence <= current_watermark) && !is_deep_strict_equal(old, part)) {
      throw new Error(part.sequence <= current_watermark ? "session_stable_prefix_immutable" : "session_changed_parts_missing");
    }
    changed.delete(part.part_id);
  }
  if (changed.size) throw new Error("session_changed_parts_invalid");
}
