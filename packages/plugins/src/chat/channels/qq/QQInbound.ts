/**
 * QQInbound：QQ 入站消息归一化辅助。
 *
 * 关键点（中文）
 * - 只做字段提取、文本清洗、作者识别、附件宽松归一化。
 * - 不依赖 QQBot 实例状态，便于测试与复用。
 * - 具体“授权、入队、执行、回发”仍由 QQBot 负责编排。
 */

import type { JsonObject } from "@downcity/agent";
import type { QqIncomingAttachment } from "@/chat/types/QqVoice.js";
import type { QqActorIdentity, QQAuthor, QQMessageData } from "@/chat/channels/qq/types/QqChannel.js";
import { extractQqIncomingAttachments } from "./VoiceInput.js";

/**
 * 解析入站会话展示名（群名/频道名/私聊对象名）。
 */
export function resolveQqInboundChatTitle(params: {
  chatType: string;
  data: QQMessageData;
  actorName?: string;
}): string | undefined {
  const chatType = String(params.chatType || "").trim().toLowerCase();
  const raw = params.data as unknown as JsonObject;
  const groupObj =
    raw.group && typeof raw.group === "object" && !Array.isArray(raw.group)
      ? (raw.group as JsonObject)
      : null;
  const channelObj =
    raw.channel && typeof raw.channel === "object" && !Array.isArray(raw.channel)
      ? (raw.channel as JsonObject)
      : null;
  const guildObj =
    raw.guild && typeof raw.guild === "object" && !Array.isArray(raw.guild)
      ? (raw.guild as JsonObject)
      : null;

  const candidates = [
    chatType === "c2c" ? normalizeActorDisplayName(params.actorName) : "",
    raw.group_name,
    raw.groupName,
    raw.group_title,
    raw.groupTitle,
    raw.channel_name,
    raw.channelName,
    raw.guild_name,
    raw.guildName,
    raw.chat_name,
    raw.chatName,
    raw.title,
    raw.name,
    groupObj?.name,
    groupObj?.title,
    channelObj?.name,
    channelObj?.title,
    guildObj?.name,
    guildObj?.title,
  ];
  for (const candidate of candidates) {
    const value = normalizeActorDisplayName(candidate);
    if (value) return value;
  }
  return undefined;
}

/**
 * 规范化可展示昵称。
 */
export function normalizeActorDisplayName(input: unknown): string | undefined {
  const value = String(input || "").trim();
  if (!value) return undefined;
  if (isLikelyOpaqueIdentifier(value)) return undefined;
  return value;
}

/**
 * 从 QQ webhook 负载中抽取作者身份。
 */
export function extractQqAuthorIdentity(
  author: QQAuthor | undefined,
  data?: QQMessageData,
): QqActorIdentity {
  const rawAuthor =
    author && typeof author === "object" && !Array.isArray(author)
      ? (author as unknown as Record<string, unknown>)
      : {};
  const rawAuthorUser =
    rawAuthor.user &&
    typeof rawAuthor.user === "object" &&
    !Array.isArray(rawAuthor.user)
      ? (rawAuthor.user as Record<string, unknown>)
      : {};
  const rawData =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as unknown as Record<string, unknown>)
      : {};
  const rawSender =
    rawData.sender &&
    typeof rawData.sender === "object" &&
    !Array.isArray(rawData.sender)
      ? (rawData.sender as Record<string, unknown>)
      : {};
  const rawMember =
    rawData.member &&
    typeof rawData.member === "object" &&
    !Array.isArray(rawData.member)
      ? (rawData.member as Record<string, unknown>)
      : {};

  const userIdCandidates = [
    author?.member_openid,
    author?.user_openid,
    author?.openid,
    author?.union_openid,
    author?.id,
    author?.user_id,
    author?.tiny_id,
    author?.member_tinyid,
    author?.user_tinyid,
    author?.uid,
    author?.user?.id,
    author?.user?.user_id,
    author?.user?.openid,
    author?.user?.user_openid,
    rawData.user_openid,
    rawData.openid,
    rawData.author_id,
    rawData.user_id,
    rawSender.user_openid,
    rawSender.openid,
    rawSender.id,
    rawSender.user_id,
    rawMember.user_openid,
    rawMember.openid,
    rawMember.id,
    rawMember.user_id,
  ];
  const usernameCandidates = [
    author?.nickname,
    author?.username,
    author?.name,
    author?.user?.username,
    author?.user?.nickname,
    author?.user?.name,
    rawAuthor.nick,
    rawAuthor.display_name,
    rawAuthor.display_name,
    rawAuthor.member_nick,
    rawAuthor.memberNick,
    rawAuthor.card,
    rawAuthor.remark,
    rawAuthorUser.nick,
    rawAuthorUser.display_name,
    rawAuthorUser.display_name,
    rawData.nickname,
    rawData.username,
    rawData.nick,
    rawData.user_name,
    rawData.userName,
    rawData.display_name,
    rawData.display_name,
    rawSender.nickname,
    rawSender.username,
    rawSender.nick,
    rawSender.user_name,
    rawSender.userName,
    rawSender.card,
    rawMember.nickname,
    rawMember.username,
    rawMember.nick,
    rawMember.card,
  ];

  const user_id = userIdCandidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
  const username = usernameCandidates
    .map((value) => normalizeActorDisplayName(value))
    .find(Boolean);

  return {
    ...(user_id ? { user_id } : {}),
    ...(username ? { username } : {}),
  };
}

/**
 * 提取纯文本内容。
 */
export function extractQqTextContent(content: string): string {
  if (!content) return "";
  return String(content).replace(/\s+/g, " ").trim();
}

/**
 * 仅移除消息中的机器人 mention。
 */
export function stripQqBotMention(content: string, botUserId: string): string {
  const raw = String(content || "");
  if (!raw) return "";

  const normalizedBotUserId = String(botUserId || "").trim();
  if (!normalizedBotUserId) return raw.trim();

  const escaped = escapeRegExp(normalizedBotUserId);
  return raw
    .replace(new RegExp(`<@!?${escaped}>`, "ig"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 宽松提取 QQ 入站附件。
 */
export function extractQqInboundAttachments(data: QQMessageData): QqIncomingAttachment[] {
  return extractQqIncomingAttachments({
    attachments: data.attachments,
    files: data.files,
    file_info: data.file_info,
    file_infos: data.file_infos,
    media: data.media,
    medias: data.medias,
    audio: data.audio,
    voice: data.voice,
  });
}

/**
 * 构造入站审计文本，保证结果非空。
 */
export function buildQqAuditText(params: {
  rawContent: string;
  cleanedText: string;
  hasIncomingAttachment: boolean;
}): string {
  const raw = String(params.rawContent || "").trim();
  if (raw) return raw;

  const cleaned = String(params.cleanedText || "").trim();
  if (cleaned) return cleaned;

  if (params.hasIncomingAttachment) return "[attachment] (qq)";
  return "[message] (no_text_or_supported_attachment)";
}

/**
 * 判断一个字符串是否更像平台内部 ID。
 */
function isLikelyOpaqueIdentifier(input: string): boolean {
  const value = String(input || "").trim();
  if (!value) return false;
  if (/^[0-9A-F]{24,}$/i.test(value)) return true;
  if (/^[0-9]{18,}$/.test(value)) return true;
  return false;
}

/**
 * 正则转义。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
