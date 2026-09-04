/**
 * Feishu Bot 信息探测实现。
 *
 * 关键点（中文）
 * - 先通过 appId/appSecret 换取 tenant access token。
 * - 再尝试读取 bot profile，失败时回退到凭据推断。
 * - 官方接口返回体核心字段在 `bot.app_name` / `bot.open_id`，这里同时兼容旧兜底结构。
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

function normalizeDomain(input: string): string {
  const text = String(input || "").trim();
  return (text || "https://open.feishu.cn").replace(/\/+$/, "");
}

type FeishuBotInfoPayload = {
  code?: number;
  msg?: string;
  bot?: {
    activate_status?: number;
    app_name?: string;
    avatar_url?: string;
    ip_white_list?: string[];
    open_id?: string;
  };
  data?: {
    bot_name?: string;
    name?: string;
    app_name?: string;
    open_id?: string;
    bot_open_id?: string;
    bot_id?: string;
    app_id?: string;
    owner?: string;
    owner_name?: string;
    owner_open_id?: string;
    creator?: string;
    creator_name?: string;
    creator_open_id?: string;
    bot?: {
      bot_name?: string;
      name?: string;
      app_name?: string;
      open_id?: string;
      bot_open_id?: string;
      bot_id?: string;
    };
  };
};

/**
 * Feishu 渠道 Bot 信息探测器。
 */
export class FeishuBotInfoProvider implements ChatChannelBotInfoProvider {
  readonly channel = "feishu" as const;

  /**
   * 探测 Feishu bot 信息。
   */
  async resolve(credentials: ChatBotInfoCredentialInput): Promise<ChatBotInfoResult> {
    const appId = String(credentials.appId || "").trim();
    const appSecret = String(credentials.appSecret || "").trim();
    const domain = normalizeDomain(String(credentials.domain || ""));

    if (!appId || !appSecret) {
      throw new Error("Missing appId/appSecret");
    }

    const authEndpoint = `${domain}/open-apis/auth/v3/tenant_access_token/internal`;
    const authResponse = await fetch(authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    });
    const authRaw = await authResponse.text();
    let authPayload: {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      app_access_token?: string;
    } = {};
    try {
      authPayload = JSON.parse(authRaw) as typeof authPayload;
    } catch {
      authPayload = {};
    }

    const token = pickFirstNonEmpty([
      authPayload.tenant_access_token,
      authPayload.app_access_token,
    ]);
    if (!authResponse.ok || authPayload.code !== 0 || !token) {
      const details = pickFirstNonEmpty([authPayload.msg, authRaw, `HTTP ${authResponse.status}`]);
      throw new Error(`Feishu bot info probe failed: ${details}`);
    }

    // 关键点（中文）：尽力读取 bot profile，若失败则使用 appId 回退。
    let botName = "";
    let botOpenId = "";
    try {
      const profileResponse = await fetch(`${domain}/open-apis/bot/v3/info`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const profileRaw = await profileResponse.text();
      const profilePayload = JSON.parse(profileRaw) as FeishuBotInfoPayload;
      if (profileResponse.ok && profilePayload.code === 0) {
        // 关键点（中文）：官方文档当前返回 `bot.app_name` / `bot.open_id`。
        // 为了兼容历史或不同网关形态，保留对旧 `data.*` 结构的兜底读取。
        botName = pickFirstNonEmpty([
          profilePayload.bot?.app_name,
          profilePayload.data?.bot_name,
          profilePayload.data?.name,
          profilePayload.data?.app_name,
          profilePayload.data?.bot?.bot_name,
          profilePayload.data?.bot?.name,
          profilePayload.data?.bot?.app_name,
        ]);
        botOpenId = pickFirstNonEmpty([
          profilePayload.bot?.open_id,
          profilePayload.data?.open_id,
          profilePayload.data?.bot_open_id,
          profilePayload.data?.bot_id,
          profilePayload.data?.bot?.open_id,
          profilePayload.data?.bot?.bot_open_id,
          profilePayload.data?.bot?.bot_id,
          profilePayload.data?.app_id,
        ]);
        const owner = pickFirstNonEmpty([
          profilePayload.data?.owner_name,
          profilePayload.data?.owner,
          profilePayload.data?.owner_open_id,
        ]);
        const creator = pickFirstNonEmpty([
          profilePayload.data?.creator_name,
          profilePayload.data?.creator,
          profilePayload.data?.creator_open_id,
        ]);
        return {
          channel: this.channel,
          name: pickFirstNonEmpty([
            botName,
            `Feishu Bot ${appId.slice(-6)}`,
            "Feishu Bot",
          ]),
          identity: pickFirstNonEmpty([botOpenId, appId]) || undefined,
          owner: owner || undefined,
          creator: creator || undefined,
          botUserId: botOpenId || undefined,
          idSeed: pickFirstNonEmpty([botOpenId, appId, "bot"]),
          message: botName
            ? "Feishu bot profile fetched"
            : "Feishu credentials verified; fallback profile generated",
        };
      }
    } catch {
      // ignore profile lookup error
    }

    const name = pickFirstNonEmpty([
      botName,
      `Feishu Bot ${appId.slice(-6)}`,
      "Feishu Bot",
    ]);
    const identity = pickFirstNonEmpty([botOpenId, appId]);

    return {
      channel: this.channel,
      name,
      identity: identity || undefined,
      owner: undefined,
      creator: undefined,
      botUserId: botOpenId || undefined,
      idSeed: pickFirstNonEmpty([botOpenId, appId, "bot"]),
      message: botName
        ? "Feishu bot profile fetched"
        : "Feishu credentials verified; fallback profile generated",
    };
  }
}
