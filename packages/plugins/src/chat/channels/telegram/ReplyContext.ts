/**
 * Telegram reply 引用上下文提取。
 *
 * 关键点（中文）
 * - 直接从 `reply_to_message` / `quote` 提取可执行上下文。
 * - 不依赖额外 API 回查，保证处理链路轻量稳定。
 */

import type { InboundReplyContext } from "@/chat/types/ReplyContext.js";
import {
  getActorName,
  type TelegramUpdate,
} from "./Shared.js";

type TelegramReplyMessageLike = {
  text?: string;
  caption?: string;
  document?: unknown;
  photo?: unknown[];
  voice?: unknown;
  audio?: unknown;
  video?: unknown;
};

function describeTelegramMessage(
  message: TelegramReplyMessageLike | undefined,
): string | undefined {
  const rawText =
    typeof message?.text === "string"
      ? message.text
      : typeof message?.caption === "string"
        ? message.caption
        : "";
  const normalizedText = rawText.trim();
  if (normalizedText) return normalizedText;

  const attachmentTypes: string[] = [];
  if (message?.document) attachmentTypes.push("document");
  if (Array.isArray(message?.photo) && message.photo.length > 0) {
    attachmentTypes.push("photo");
  }
  if (message?.voice) attachmentTypes.push("voice");
  if (message?.audio) attachmentTypes.push("audio");
  if (message?.video) attachmentTypes.push("video");

  const uniqTypes = Array.from(new Set(attachmentTypes)).filter(Boolean);
  if (uniqTypes.length === 0) return undefined;
  return `[attachment] (${uniqTypes.join(", ")})`;
}

/**
 * 提取 Telegram reply 上下文。
 */
export function extractTelegramReplyContext(
  message: TelegramUpdate["message"] | undefined,
): InboundReplyContext | undefined {
  const replied = message?.reply_to_message;
  if (!replied) return undefined;

  const message_id =
    typeof replied.message_id === "number" && Number.isFinite(replied.message_id)
      ? String(replied.message_id)
      : undefined;
  const actorName = getActorName(replied.from);
  const text = describeTelegramMessage(replied);
  const quoteText =
    typeof message?.quote?.text === "string" ? message.quote.text.trim() : undefined;

  if (!message_id && !actorName && !text && !quoteText) return undefined;
  return {
    ...(message_id ? { message_id } : {}),
    ...(actorName ? { actorName } : {}),
    ...(text ? { text } : {}),
    ...(quoteText ? { quoteText } : {}),
  };
}
