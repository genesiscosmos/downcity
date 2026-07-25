/**
 * Feishu reply 引用上下文归一化。
 *
 * 关键点（中文）
 * - 把 `message.get` 查回来的父消息内容转换成统一 reply 上下文。
 * - 文本消息保留正文，附件消息退化为稳定占位描述。
 */

import type { InboundReplyContext } from "@/chat/types/ReplyContext.js";
import { parseFeishuInboundMessage } from "./InboundAttachment.js";

function describeFeishuMessage(params: {
  messageType?: string;
  content?: string;
}): string | undefined {
  const messageType = String(params.messageType || "").trim();
  const content = String(params.content || "").trim();
  if (!messageType || !content) return undefined;

  try {
    const parsed = parseFeishuInboundMessage({
      messageType,
      content,
    });
    const text = String(parsed.text || "").trim();
    if (text) return text;

    if (parsed.attachments.length > 0) {
      const labels = parsed.attachments.map((attachment) => {
        const name = String(attachment.description || attachment.fileName || "").trim();
        return name ? `${attachment.type}:${name}` : attachment.type;
      });
      return `[attachment] (${labels.join(", ")})`;
    }

    if (parsed.unsupportedType) {
      return `[unsupported_message] (${parsed.unsupportedType})`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * 构造 Feishu reply 上下文。
 */
export function buildFeishuReplyContext(params: {
  message_id?: string;
  actorName?: string;
  messageType?: string;
  content?: string;
}): InboundReplyContext | undefined {
  const message_id = String(params.message_id || "").trim();
  const actorName = String(params.actorName || "").trim();
  const text = describeFeishuMessage({
    messageType: params.messageType,
    content: params.content,
  });

  if (!actorName && !text) return undefined;
  return {
    ...(message_id ? { message_id } : {}),
    ...(actorName ? { actorName } : {}),
    ...(text ? { text } : {}),
  };
}
