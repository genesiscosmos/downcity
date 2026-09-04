/**
 * ChatPromptAssets：chat plugin runtime 静态提示词资产。
 *
 * 关键点（中文）
 * - prompt 文本真实来源是 `*.ts.txt` 文本文件。
 * - 这里统一做 `trim()`，避免多渠道 prompt 行为不一致。
 */

import chatPluginPromptText from "@/chat/PROMPT.direct.js";
import feishuChatPromptText from "@/chat/channels/feishu/PROMPT.direct.js";
import qqChatPromptText from "@/chat/channels/qq/PROMPT.direct.js";
import telegramChatPromptText from "@/chat/channels/telegram/PROMPT.direct.js";

/**
 * chat plugin runtime 基础 prompt。
 */
export const CHAT_PLUGIN_PROMPT = chatPluginPromptText.trim();

/**
 * 飞书 channel prompt。
 */
export const FEISHU_CHAT_CHANNEL_PROMPT = feishuChatPromptText.trim();

/**
 * QQ chat platform prompt。
 */
export const QQ_CHAT_CHANNEL_PROMPT = qqChatPromptText.trim();

/**
 * Telegram channel prompt。
 */
export const TELEGRAM_CHAT_CHANNEL_PROMPT = telegramChatPromptText.trim();
