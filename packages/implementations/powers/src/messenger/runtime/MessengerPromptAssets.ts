/**
 * MessengerPromptAssets：messenger power runtime 静态提示词资产。
 *
 * 关键点（中文）
 * - prompt 文本真实来源是 `*.ts.txt` 文本文件。
 * - 这里统一做 `trim()`，避免多渠道 prompt 行为不一致。
 */

import messengerPowerPromptText from "@/messenger/PROMPT.direct.js";
import feishuMessengerPromptText from "@/messenger/channels/feishu/PROMPT.direct.js";
import telegramMessengerPromptText from "@/messenger/channels/telegram/PROMPT.direct.js";

/**
 * messenger power runtime 基础 prompt。
 */
export const MESSENGER_POWER_PROMPT = messengerPowerPromptText.trim();

/**
 * 飞书 channel prompt。
 */
export const FEISHU_MESSENGER_CHANNEL_PROMPT = feishuMessengerPromptText.trim();

/**
 * Telegram channel prompt。
 */
export const TELEGRAM_MESSENGER_CHANNEL_PROMPT = telegramMessengerPromptText.trim();
