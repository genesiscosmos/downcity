/**
 * Telegram Bot 信息探测实现。
 *
 * 关键点（中文）
 * - 基于 `getMe` 接口验证 token 有效性。
 * - 返回统一结构，供 chat account 创建流程复用。
 */

import type {
  ChatBotInfoCredentialInput,
  ChatBotInfoResult,
  ChatChannelBotInfoProvider,
} from "@/chat/types/BotInfo.js";

function pickFirstNonEmpty(inputs: unknown[]): string {
  for (const input of inputs) {
    const text = String(input || "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * Telegram 渠道 Bot 信息探测器。
 */
export class TelegramBotInfoProvider implements ChatChannelBotInfoProvider {
  readonly channel = "telegram" as const;

  /**
   * 探测 Telegram bot 信息。
   */
  async resolve(credentials: ChatBotInfoCredentialInput): Promise<ChatBotInfoResult> {
    const botToken = String(credentials.botToken || "").trim();
    if (!botToken) {
      throw new Error("Missing botToken");
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const raw = await response.text();
    let payload: {
      ok?: boolean;
      result?: {
        id?: number | string;
        username?: string;
        first_name?: string;
        last_name?: string;
      };
      description?: string;
      error_code?: number;
    } = {};
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      payload = {};
    }

    if (!response.ok || payload.ok !== true) {
      const details = String(payload.description || raw || "unknown error").trim();
      throw new Error(`Telegram bot info probe failed: ${details}`);
    }

    const botUserId = String(payload.result?.id || "").trim();
    const username = String(payload.result?.username || "").trim();
    const firstName = String(payload.result?.first_name || "").trim();
    const lastName = String(payload.result?.last_name || "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    const name = pickFirstNonEmpty([
      fullName,
      username ? `@${username.replace(/^@+/, "")}` : "",
      botUserId ? `Telegram Bot ${botUserId.slice(-6)}` : "",
      "Telegram Bot",
    ]);
    const identity = pickFirstNonEmpty([
      username ? `@${username.replace(/^@+/, "")}` : "",
      botUserId,
    ]);

    return {
      channel: this.channel,
      name,
      identity: identity || undefined,
      botUserId: botUserId || undefined,
      idSeed: pickFirstNonEmpty([username, botUserId, "bot"]),
      message: "Telegram bot profile fetched",
    };
  }
}
