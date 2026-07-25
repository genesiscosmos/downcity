/**
 * Chat account 管理器。
 *
 * 关键点（中文）
 * - 统一封装 agent 运行时下 chat account 的 CRUD 与探测。
 * - 账号凭据只在写入路径接收明文；列表与读取路径返回脱敏结果。
 * - city / vibecape 等上层产品都应直接复用这个实现，而不是各自维护副本。
 */

import crypto from "node:crypto";
import { resolveChatChannelBotInfo } from "@/chat/channels/BotInfoProvider.js";
import type {
  ChatChannelAccountCreateInput,
  ChatChannelAccountListItem,
  ChatChannelAccountListResult,
  ChatChannelAccountProbeResult,
  ChatChannelAccountUpsertInput,
} from "@/chat/types/ChannelAccount.js";
import type {
  ChatChannelAccountStore,
  StoredChannelAccount,
  StoredChannelAccountChannel,
} from "@/chat/types/ChannelAccountStore.js";

const SUPPORTED_CHANNELS: readonly StoredChannelAccountChannel[] = [
  "telegram",
  "feishu",
  "qq",
];

function maskSecret(value: string | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return "***";
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function assertChannel(input: string): StoredChannelAccountChannel {
  const channel = String(input || "").trim().toLowerCase() as StoredChannelAccountChannel;
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(
      `Unsupported channel: ${input}. Supported: ${SUPPORTED_CHANNELS.join(", ")}`,
    );
  }
  return channel;
}

/** 将外部渠道输入收敛为 Chat Account 支持的稳定枚举。 */
function normalize_channel_account_channel(
  input: string,
): StoredChannelAccountChannel {
  return assertChannel(input);
}

function normalizeOptionalText(value: unknown): string | undefined {
  const text = String(value || "").trim();
  return text || undefined;
}

function normalizeChannelAccountIdToken(value: string): string {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return token || "bot";
}

function pickFirstNonEmpty(inputs: unknown[]): string {
  for (const input of inputs) {
    const text = String(input || "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * ChatChannelAccountManager。
 */
export class ChatChannelAccountManager {
  /** 当前管理器唯一使用的宿主账号存储。 */
  private readonly account_store: ChatChannelAccountStore;

  constructor(account_store: ChatChannelAccountStore) {
    this.account_store = account_store;
  }

  /**
   * 生成唯一 chat account id。
   *
   * 关键点（中文）
   * - 账号 id 统一由系统生成，避免用户手填导致冲突或命名不一致。
   * - 若碰撞则自动追加随机后缀重试。
   */
  private async generateUniqueAccountId(params: {
    channel: StoredChannelAccountChannel;
    seed?: string;
  }): Promise<string> {
    const seed = normalizeChannelAccountIdToken(params.seed || "");
    const prefix = `${params.channel}-${seed}`.slice(0, 36);
    for (let index = 0; index < 8; index += 1) {
      const suffix = crypto.randomBytes(3).toString("hex");
      const candidate = `${prefix}-${suffix}`.slice(0, 64);
      const existing = this.account_store.get(candidate);
      if (!existing) return candidate;
    }
    return `${params.channel}-${Date.now().toString(36)}`;
  }

  /**
   * 探测 bot 凭据并返回自动填充信息。
   */
  async probe(input: {
    channel: string;
    botToken?: string;
    appId?: string;
    appSecret?: string;
    domain?: string;
    sandbox?: boolean;
  }): Promise<ChatChannelAccountProbeResult> {
    const channel = assertChannel(input.channel);
    const botInfo = await resolveChatChannelBotInfo({
      channel,
      credentials: {
        botToken: normalizeOptionalText(input.botToken),
        appId: normalizeOptionalText(input.appId),
        appSecret: normalizeOptionalText(input.appSecret),
        domain: normalizeOptionalText(input.domain),
        sandbox: input.sandbox === true,
      },
    });
    const accountId = await this.generateUniqueAccountId({
      channel,
      seed: pickFirstNonEmpty([
        botInfo.idSeed,
        botInfo.botUserId,
        botInfo.identity,
        botInfo.name,
        "bot",
      ]),
    });

    return {
      channel,
      accountId,
      name: botInfo.name,
      identity: botInfo.identity,
      owner: botInfo.owner,
      creator: botInfo.creator,
      botUserId: botInfo.botUserId,
      message: botInfo.message,
    };
  }

  /**
   * 使用凭据创建账号。
   *
   * 关键点（中文）
   * - 默认先尝试探测 bot 信息，成功时自动填充名称与身份。
   * - 探测失败但用户提供了名称时，仍允许先保存，便于后续排障。
   */
  async create(input: ChatChannelAccountCreateInput): Promise<{
    id: string;
    probed: boolean;
    message?: string;
  }> {
    const channel = assertChannel(input.channel);
    let probeResult: ChatChannelAccountProbeResult | null = null;
    if (input.probe !== false) {
      try {
        probeResult = await this.probe({
          channel,
          botToken: input.botToken,
          appId: input.appId,
          appSecret: input.appSecret,
          domain: input.domain,
          sandbox: input.sandbox,
        });
      } catch (error) {
        if (!normalizeOptionalText(input.name)) {
          throw error;
        }
      }
    }

    const id =
      probeResult?.accountId ||
      (await this.generateUniqueAccountId({
        channel,
        seed: pickFirstNonEmpty([input.name, input.appId, "bot"]),
      }));
    const name = normalizeOptionalText(input.name) || probeResult?.name || `${channel} bot`;

    await this.upsert({
      id,
      channel,
      name,
      identity: probeResult?.identity,
      owner: probeResult?.owner,
      creator: probeResult?.creator,
      botToken: input.botToken,
      appId: input.appId,
      appSecret: input.appSecret,
      domain: input.domain,
      sandbox: input.sandbox,
    });

    return {
      id,
      probed: Boolean(probeResult),
      message: probeResult?.message,
    };
  }

  /**
   * 列出账户池（脱敏）。
   */
  async list(): Promise<ChatChannelAccountListResult> {
    return {
      items: this.account_store.list().map((account) =>
        toChannelAccountListItem(account),
      ),
    };
  }

  /**
   * 新增或更新账号。
   */
  async upsert(input: ChatChannelAccountUpsertInput): Promise<{ id: string }> {
    const id = String(input.id || "").trim();
    if (!id) throw new Error("chat account id cannot be empty");
    const name = String(input.name || "").trim();
    if (!name) throw new Error("chat account name cannot be empty");

    const channel = normalize_channel_account_channel(input.channel);

    if (input.botToken !== undefined && input.clearBotToken === true) {
      throw new Error("botToken and clearBotToken cannot be used together");
    }
    if (input.appId !== undefined && input.clearAppId === true) {
      throw new Error("appId and clearAppId cannot be used together");
    }
    if (input.appSecret !== undefined && input.clearAppSecret === true) {
      throw new Error("appSecret and clearAppSecret cannot be used together");
    }

    const current = this.account_store.get(id);
    const nextBotToken = input.clearBotToken
      ? undefined
      : input.botToken !== undefined
        ? normalizeOptionalText(input.botToken)
        : current?.botToken;
    const nextAppId = input.clearAppId
      ? undefined
      : input.appId !== undefined
        ? normalizeOptionalText(input.appId)
        : current?.appId;
    const nextAppSecret = input.clearAppSecret
      ? undefined
      : input.appSecret !== undefined
        ? normalizeOptionalText(input.appSecret)
        : current?.appSecret;
    const nextIdentity = Object.prototype.hasOwnProperty.call(input, "identity")
      ? normalizeOptionalText(input.identity)
      : current?.identity;
    const nextOwner = Object.prototype.hasOwnProperty.call(input, "owner")
      ? normalizeOptionalText(input.owner)
      : current?.owner;
    const nextCreator = Object.prototype.hasOwnProperty.call(input, "creator")
      ? normalizeOptionalText(input.creator)
      : current?.creator;

    await this.account_store.upsert({
      id,
      channel,
      name,
      identity: nextIdentity,
      owner: nextOwner,
      creator: nextCreator,
      botToken: nextBotToken,
      appId: nextAppId,
      appSecret: nextAppSecret,
      domain: normalizeOptionalText(input.domain),
      sandbox: input.sandbox === true,
    });
    return { id };
  }

  /**
   * 删除账号。
   */
  async remove(idInput: string): Promise<void> {
    const id = String(idInput || "").trim();
    if (!id) throw new Error("chat account id cannot be empty");
    await this.account_store.remove(id);
  }
}

function toChannelAccountListItem(
  account: StoredChannelAccount,
): ChatChannelAccountListItem {
  return {
    id: account.id,
    channel: account.channel,
    name: account.name,
    identity: account.identity,
    owner: account.owner,
    creator: account.creator,
    domain: account.domain,
    sandbox: account.sandbox === true,
    hasBotToken: !!String(account.botToken || "").trim(),
    hasAppId: !!String(account.appId || "").trim(),
    hasAppSecret: !!String(account.appSecret || "").trim(),
    botTokenMasked: maskSecret(account.botToken),
    appIdMasked: maskSecret(account.appId),
    appSecretMasked: maskSecret(account.appSecret),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
