/**
 * ReplyContextFormatter：reply 引用上下文格式化工具。
 *
 * 关键点（中文）
 * - 把平台 reply 信息稳定地拼进模型输入正文。
 * - 同时提供额外 metadata，便于 history / 调试链路查看。
 */

import type { JsonObject } from "@downcity/agent";
import type { InboundReplyContext } from "@/chat/types/ReplyContext.js";

function normalizeReplyValue(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  return text ? text : undefined;
}

/**
 * 将 reply 上下文转换为执行输入正文。
 *
 * 说明（中文）
 * - 当前消息正文为空时，也会保留 reply block，避免“只看见 reply、看不见被引用内容”。
 * - quote 与完整正文相同则自动去重，避免重复噪声。
 */
export function buildReplyContextInstruction(params: {
  text: string;
  replyContext?: InboundReplyContext;
}): string {
  const body = String(params.text ?? "").trim();
  const replyContext = params.replyContext;
  if (!replyContext) return body;

  const message_id = normalizeReplyValue(replyContext.message_id);
  const actorName = normalizeReplyValue(replyContext.actorName);
  const quoteText = normalizeReplyValue(replyContext.quoteText);
  const replyText = normalizeReplyValue(replyContext.text);
  const normalizedQuote =
    quoteText && quoteText !== replyText ? quoteText : undefined;

  if (!message_id && !actorName && !normalizedQuote && !replyText) {
    return body;
  }

  const lines: string[] = ["<reply_context>"];
  if (message_id) lines.push(`reply_message_id: ${message_id}`);
  if (actorName) lines.push(`reply_actor_name: ${actorName}`);
  if (normalizedQuote) {
    lines.push("reply_quote:");
    lines.push(normalizedQuote);
  }
  if (replyText) {
    lines.push("reply_message:");
    lines.push(replyText);
  }
  lines.push("</reply_context>");

  if (!body) return lines.join("\n");
  return `${lines.join("\n")}\n\n${body}`;
}

/**
 * 将 reply 上下文转换为 ingress extra。
 *
 * 说明（中文）
 * - 仅保留稳定、短小的字段。
 * - 方便在 Console / history 中直接看到引用信息。
 */
export function buildReplyContextExtra(
  replyContext?: InboundReplyContext,
): JsonObject | undefined {
  if (!replyContext) return undefined;

  const message_id = normalizeReplyValue(replyContext.message_id);
  const actorName = normalizeReplyValue(replyContext.actorName);
  const text = normalizeReplyValue(replyContext.text);
  const quoteText = normalizeReplyValue(replyContext.quoteText);
  if (!message_id && !actorName && !text && !quoteText) return undefined;

  return {
    hasReplyContext: true,
    ...(message_id ? { replyMessageId: message_id } : {}),
    ...(actorName ? { replyActorName: actorName } : {}),
    ...(text ? { replyText: text } : {}),
    ...(quoteText ? { replyQuoteText: quoteText } : {}),
  };
}
