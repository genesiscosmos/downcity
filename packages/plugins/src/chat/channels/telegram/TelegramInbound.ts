/**
 * TelegramInbound：Telegram 入站辅助逻辑。
 *
 * 关键点（中文）
 * - 只负责消息 ID 解析、chat_key 构造、审计文本、mention 清理、附件保存。
 * - 不承担授权、命令分发、消息入队等主流程职责。
 */

import type { TelegramAttachmentType, TelegramUpdate } from "./Shared.js";

/**
 * 构建 lane 维度 chat_key。
 */
export function buildTelegramChatKey(
  chatId: string,
  messageThreadId?: number,
): string {
  if (
    typeof messageThreadId === "number" &&
    Number.isFinite(messageThreadId) &&
    messageThreadId > 0
  ) {
    return `telegram-chat-${chatId}-topic-${messageThreadId}`;
  }
  return `telegram-chat-${chatId}`;
}

/**
 * 解析 Telegram 消息 ID。
 */
export function parseTelegramMessageId(message_id?: string): number | undefined {
  const raw = String(message_id || "").trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

/**
 * 是否为群聊。
 */
export function isTelegramGroupChat(chatType?: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}

/**
 * 构建可落盘的审计文本。
 */
export function buildTelegramAuditText(params: {
  rawText: string;
  hasIncomingAttachment: boolean;
  message: TelegramUpdate["message"];
}): string {
  const rawText = String(params.rawText ?? "");
  if (rawText.trim()) return rawText;
  if (!params.hasIncomingAttachment) return "[message] (no_text_or_supported_attachment)";

  const types: string[] = [];
  const message = params.message;
  if (message?.document) types.push("document");
  if (Array.isArray(message?.photo) && message.photo.length > 0) types.push("photo");
  if (message?.voice) types.push("voice");
  if (message?.audio) types.push("audio");
  if (message?.video) types.push("video");

  const uniq = Array.from(new Set(types)).filter(Boolean);
  const suffix = uniq.length > 0 ? ` (${uniq.join(", ")})` : "";
  return `[attachment]${suffix}`;
}

/**
 * 清理 bot mention。
 */
export function stripTelegramBotMention(
  text: string,
  botUsername?: string,
): string {
  if (!text) return text;
  if (!botUsername) return text.trim();
  const re = new RegExp(`\\s*@${escapeRegExp(botUsername)}\\b`, "ig");
  return text.replace(re, " ").replace(/\s+/g, " ").trim();
}

/**
 * 保存入站附件到本地缓存。
 */
export async function saveTelegramIncomingAttachments(params: {
  downloader: {
    downloadTelegramFile: (
      fileId: string,
      suggestedName?: string,
    ) => Promise<string>;
  };
  message: TelegramUpdate["message"];
}): Promise<Array<{ type: TelegramAttachmentType; path: string; desc?: string }>> {
  const message = params.message;
  if (!message) return [];

  const items: Array<{
    type: TelegramAttachmentType;
    fileId: string;
    fileName?: string;
    desc?: string;
  }> = [];

  if (message.document?.file_id) {
    items.push({
      type: "document",
      fileId: message.document.file_id,
      fileName: message.document.file_name,
      desc: message.document.file_name,
    });
  }

  const bestPhotoId = pickBestTelegramPhotoFileId(message.photo);
  if (bestPhotoId) {
    items.push({
      type: "photo",
      fileId: bestPhotoId,
      fileName: "photo.jpg",
      desc: "photo",
    });
  }

  if (message.voice?.file_id) {
    items.push({
      type: "voice",
      fileId: message.voice.file_id,
      fileName: "voice.ogg",
      desc: "voice",
    });
  }

  if (message.audio?.file_id) {
    items.push({
      type: "audio",
      fileId: message.audio.file_id,
      fileName: message.audio.file_name || "audio",
      desc: message.audio.file_name || "audio",
    });
  }

  if (message.video?.file_id) {
    items.push({
      type: "video",
      fileId: message.video.file_id,
      fileName: message.video.file_name || "video.mp4",
      desc: message.video.file_name || "video",
    });
  }

  if (items.length === 0) return [];

  const out: Array<{ type: TelegramAttachmentType; path: string; desc?: string }> = [];
  for (const item of items) {
    const saved = await params.downloader.downloadTelegramFile(
      item.fileId,
      item.fileName,
    );
    out.push({ type: item.type, path: saved, desc: item.desc });
  }
  return out;
}

/**
 * 选出最佳 photo file_id。
 */
function pickBestTelegramPhotoFileId(
  photo?: Array<{ file_id?: string; file_size?: number }>,
): string | undefined {
  if (!Array.isArray(photo) || photo.length === 0) return undefined;
  const sorted = [...photo].sort(
    (a, b) => Number(a?.file_size || 0) - Number(b?.file_size || 0),
  );
  const best = sorted[sorted.length - 1];
  return typeof best?.file_id === "string" ? best.file_id : undefined;
}

/**
 * 正则转义。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
