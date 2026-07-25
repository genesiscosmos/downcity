/**
 * FeishuInbound：飞书入站字段归一化辅助。
 *
 * 关键点（中文）
 * - 只做发送者身份提取、mention 清理等纯逻辑。
 * - 不依赖 Feishu SDK client，也不承担授权/入队/回复职责。
 */

import type { FeishuMessageEvent, FeishuSenderIdentity } from "@/chat/channels/feishu/types/FeishuChannel.js";

/**
 * 抽取发送者主身份。
 */
export function extractFeishuSenderIdentity(
  data: FeishuMessageEvent,
): FeishuSenderIdentity {
  const openId = String(data?.sender?.sender_id?.open_id || "").trim();
  if (openId) {
    return { senderId: openId, idType: "open_id" };
  }

  const user_id = String(data?.sender?.sender_id?.user_id || "").trim();
  if (user_id) {
    return { senderId: user_id, idType: "user_id" };
  }

  const unionId = String(data?.sender?.sender_id?.union_id || "").trim();
  if (unionId) {
    return { senderId: unionId, idType: "union_id" };
  }

  return {};
}

/**
 * 清理飞书 `<at>` 提及标签。
 */
export function stripFeishuAtMentions(text: string): string {
  if (!text) return text;
  return text
    .replace(/<at\b[^>]*>[^<]*<\/at>/gi, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

/**
 * 判断是否为群聊。
 */
export function isFeishuGroupChat(chatType: string): boolean {
  return chatType !== "p2p";
}
