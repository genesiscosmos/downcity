/**
 * QQ Bot 信息探测实现。
 *
 * 关键点（中文）
 * - 先校验 appId/appSecret 可换取 access token。
 * - 再验证 gateway 可达，并尝试读取 `users/@me`。
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
 * QQ 渠道 Bot 信息探测器。
 */
export class QqBotInfoProvider implements ChatChannelBotInfoProvider {
  readonly channel = "qq" as const;

  /**
   * 探测 QQ bot 信息。
   */
  async resolve(credentials: ChatBotInfoCredentialInput): Promise<ChatBotInfoResult> {
    const appId = String(credentials.appId || "").trim();
    const appSecret = String(credentials.appSecret || "").trim();
    const sandbox = credentials.sandbox === true;

    if (!appId || !appSecret) {
      throw new Error("Missing appId/appSecret");
    }

    const authResponse = await fetch("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId,
        clientSecret: appSecret,
      }),
    });
    const authRaw = await authResponse.text();
    let authPayload: {
      access_token?: string;
      code?: number;
      message?: string;
    } = {};
    try {
      authPayload = JSON.parse(authRaw) as typeof authPayload;
    } catch {
      authPayload = {};
    }

    if (
      !authResponse.ok ||
      (typeof authPayload.code === "number" && authPayload.code !== 0) ||
      !authPayload.access_token
    ) {
      const details = pickFirstNonEmpty([
        authPayload.message,
        authRaw,
        `HTTP ${authResponse.status}`,
      ]);
      throw new Error(`QQ bot info probe failed: ${details}`);
    }

    const authHeader = `QQBot ${authPayload.access_token}`;
    const apiBase = sandbox
      ? "https://sandbox.api.sgroup.qq.com"
      : "https://api.sgroup.qq.com";

    const gatewayResponse = await fetch(`${apiBase}/gateway`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });
    const gatewayRaw = await gatewayResponse.text();
    if (!gatewayResponse.ok) {
      throw new Error(`QQ bot info probe failed: ${gatewayRaw || `HTTP ${gatewayResponse.status}`}`);
    }

    let botName = "";
    let botUserId = "";
    try {
      const meResponse = await fetch(`${apiBase}/users/@me`, {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      });
      const meRaw = await meResponse.text();
      const mePayload = JSON.parse(meRaw) as {
        id?: string;
        user_id?: string;
        username?: string;
        nickname?: string;
        name?: string;
      };
      if (meResponse.ok) {
        botUserId = pickFirstNonEmpty([mePayload.id, mePayload.user_id]);
        botName = pickFirstNonEmpty([
          mePayload.username,
          mePayload.nickname,
          mePayload.name,
        ]);
      }
    } catch {
      // ignore profile lookup error
    }

    const name = pickFirstNonEmpty([
      botName,
      `QQ Bot ${appId.slice(-6)}`,
      "QQ Bot",
    ]);
    const identity = pickFirstNonEmpty([botUserId, appId]);

    return {
      channel: this.channel,
      name,
      identity: identity || undefined,
      botUserId: botUserId || undefined,
      idSeed: pickFirstNonEmpty([botUserId, appId, "bot"]),
      message: botName
        ? "QQ bot profile fetched"
        : "QQ credentials verified; fallback profile generated",
    };
  }
}
