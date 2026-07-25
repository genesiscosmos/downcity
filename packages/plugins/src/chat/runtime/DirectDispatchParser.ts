/**
 * DirectDispatchParser：direct 模式 assistant 文本解析器。
 *
 * 关键点（中文）
 * - 默认把 assistant 文本原样当作用户可见正文发送。
 * - frontmatter metadata 语义与 `downcity chat send` 保持一致。
 * - 额外保留 `react` 字段用于 direct 模式贴表情。
 */

import type {
  DirectReactTagPayload,
  ResolvedDirectDispatchPlan,
  ResolvedDirectReactionPayload,
  ResolvedDirectTextPayload,
} from "@/chat/types/DirectDispatch.js";
import {
  build_chat_message_text,
  parse_chat_message_markup,
} from "@downcity/agent";
import { parseChatSendOptionsFromMetadata } from "@/chat/runtime/ChatSendMetadata.js";
import type { ChatMessageSegment } from "@downcity/agent";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  return text === "true" || text === "1" || text === "yes";
}

function parseReactionFromMetadata(value: unknown): DirectReactTagPayload | null {
  if (typeof value === "string") {
    const emoji = normalizeText(value);
    return emoji ? { emoji } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const emoji = normalizeText(raw.emoji);
  if (!emoji) return null;
  const big = parseBoolean(raw.big);
  return {
    emoji,
    ...(big ? { big: true } : {}),
  };
}

function parseReactionsFromMetadata(
  metadata: Record<string, unknown>,
): DirectReactTagPayload[] {
  const out: DirectReactTagPayload[] = [];
  const raw = metadata.react;
  if (!raw) return out;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const item of list) {
    const parsed = parseReactionFromMetadata(item);
    if (!parsed) continue;
    out.push(parsed);
  }
  return out;
}

function resolveTextPlan(params: {
  fallbackChatKey: string;
  metadata: Record<string, unknown>;
  segments: ChatMessageSegment[];
}): ResolvedDirectTextPayload | null {
  const sendOptions = parseChatSendOptionsFromMetadata({
    metadata: params.metadata,
    strict: false,
  });
  const chat_key = normalizeText(sendOptions.chat_key || params.fallbackChatKey);
  const text = build_chat_message_text({
    segments: params.segments,
  });
  if (!chat_key || !text) return null;

  return {
    text,
    chat_key,
    reply_to_message: sendOptions.reply_to_message === true,
    ...(typeof sendOptions.message_id === "string" && sendOptions.message_id
      ? { message_id: sendOptions.message_id }
      : {}),
    ...(typeof sendOptions.delay_ms === "number"
      ? { delay_ms: sendOptions.delay_ms }
      : {}),
    ...(typeof sendOptions.send_at_ms === "number"
      ? { send_at_ms: sendOptions.send_at_ms }
      : {}),
  };
}

function resolveReactionPlans(params: {
  fallbackChatKey: string;
  metadata: Record<string, unknown>;
  reacts: DirectReactTagPayload[];
}): ResolvedDirectReactionPayload[] {
  const out: ResolvedDirectReactionPayload[] = [];
  const sendOptions = parseChatSendOptionsFromMetadata({
    metadata: params.metadata,
    strict: false,
  });
  const chat_key = normalizeText(sendOptions.chat_key || params.fallbackChatKey);
  const message_id = normalizeText(sendOptions.message_id);
  if (!chat_key) return out;

  for (const react of params.reacts) {
    const emoji = normalizeText(react.emoji);
    if (!emoji) continue;
    out.push({
      emoji,
      chat_key,
      ...(message_id ? { message_id } : {}),
      big: react.big === true,
    });
  }
  return out;
}

/**
 * 从 assistant 文本中解析 direct 出站执行计划。
 *
 * 协议（中文）
 * - frontmatter metadata：与 `downcity chat send` 参数保持一致。
 * - 附件统一使用 `<file type=\"document|photo|voice|audio|video\">path</file>`。
 * - `react` 仍仅用于 direct 模式的反应动作。
 */
export function parseDirectDispatchAssistantText(params: {
  assistantText: string;
  fallbackChatKey: string;
}): ResolvedDirectDispatchPlan | null {
  const source = String(params.assistantText ?? "");
  const fallbackChatKey = normalizeText(params.fallbackChatKey);
  if (!normalizeText(source) || !fallbackChatKey) return null;

  const parsed = parse_chat_message_markup(source);
  const reacts = parseReactionsFromMetadata(parsed.metadata);
  const textPlan = resolveTextPlan({
    fallbackChatKey,
    metadata: parsed.metadata,
    segments: parsed.segments,
  });
  const reactionPlans = resolveReactionPlans({
    fallbackChatKey,
    metadata: parsed.metadata,
    reacts,
  });

  if (!textPlan && reactionPlans.length === 0) return null;
  return {
    text: textPlan,
    reactions: reactionPlans,
  };
}
