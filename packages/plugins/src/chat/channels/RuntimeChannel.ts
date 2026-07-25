/**
 * Chat channel SDK 基类与内置 channel 实现。
 *
 * 关键点（中文）
 * - channel 对象是 ChatPlugin 的运行态配置单元。
 * - env 由 channel 自己读取，ChatPlugin 不理解平台字段。
 * - channelAccountId 仅作为账号池绑定能力保留，不再是 ChatPlugin 顶层配置。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";
import type { ChatChannel } from "@/chat/types/ChatPluginOptions.js";
import type {
  ChatChannelAccountStore,
  StoredChannelAccount,
} from "@/chat/types/ChannelAccountStore.js";

/**
 * env 字典。
 */
export type ChatChannelEnv = Record<string, string | undefined>;

/**
 * Chat channel 基础配置。
 */
export interface BaseChatChannelOptions {
  /**
   * 是否启用该 channel。
   *
   * 说明（中文）
   * - 默认值为 `true`，因为传入 channel 对象通常表示希望启用它。
   * - 该值由宿主构造 channel 时传入，运行期间保持不变。
   */
  enabled?: boolean;
  /**
   * channel 专属 env。
   *
   * 说明（中文）
   * - 这里面放面向人类可读的环境变量名，例如 `TELEGRAM_BOT_TOKEN`。
   * - channel 会自行读取所需字段。
   */
  env?: ChatChannelEnv;
  /**
   * 可选账号池绑定 ID。
   *
   * 说明（中文）
   * - 仅在需要复用全局账号池时使用。
   * - SDK 主路径推荐直接通过 `env` 传入凭据。
   */
  channelAccountId?: string;
  /**
   * 运行态展示名称。
   */
  name?: string;
}

abstract class BaseRuntimeChatChannel implements ChatChannel {
  /**
   * channel 名称。
   */
  abstract readonly name: ChatChannelName;

  protected enabled: boolean;
  protected env: ChatChannelEnv;
  protected channelAccountId: string;
  protected display_name: string;

  protected constructor(options: BaseChatChannelOptions = {}) {
    this.enabled = options.enabled !== false;
    this.env = options.env || {};
    this.channelAccountId = String(options.channelAccountId || "").trim();
    this.display_name = String(options.name || "").trim();
  }

  isEnabled(_context: PluginContext): boolean {
    return this.enabled;
  }

  getChannelAccountId(_context: PluginContext): string {
    return this.channelAccountId;
  }

  protected getStoredAccount(
    account_store?: ChatChannelAccountStore,
  ): StoredChannelAccount | null {
    if (!this.channelAccountId || !account_store) return null;
    const account = account_store.get(this.channelAccountId);
    if (!account || account.channel !== this.name) return null;
    return account;
  }

  protected nowIso(): string {
    return new Date().toISOString();
  }

  abstract getAccount(
    context: PluginContext,
    account_store?: ChatChannelAccountStore,
  ): StoredChannelAccount | null;
}

/**
 * Telegram channel 配置。
 */
export interface TelegramChannelOptions extends BaseChatChannelOptions {
  /**
   * Telegram bot token。
   *
   * 说明（中文）
   * - 优先级高于 `env.TELEGRAM_BOT_TOKEN`。
   */
  botToken?: string;
}

/**
 * Telegram channel。
 */
export class TelegramChannel extends BaseRuntimeChatChannel {
  readonly name = "telegram" as const;
  private readonly botToken?: string;

  constructor(options: TelegramChannelOptions = {}) {
    super(options);
    this.botToken = String(options.botToken || "").trim() || undefined;
  }

  getAccount(
    _context: PluginContext,
    account_store?: ChatChannelAccountStore,
  ): StoredChannelAccount | null {
    const storedAccount = this.getStoredAccount(account_store);
    if (storedAccount) return storedAccount;

    const token = String(this.botToken || this.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!token) return null;
    const now = this.nowIso();
    return {
      id: this.channelAccountId || "chat-sdk-telegram",
      channel: "telegram",
      name: this.display_name || "telegram",
      botToken: token,
      created_at: now,
      updated_at: now,
    };
  }
}

/**
 * Feishu channel 配置。
 */
export interface FeishuChannelOptions extends BaseChatChannelOptions {
  /**
   * Feishu / Lark App ID。
   */
  appId?: string;
  /**
   * Feishu / Lark App Secret。
   */
  appSecret?: string;
  /**
   * Feishu / Lark Open API 域名。
   */
  domain?: string;
}

/**
 * Feishu channel。
 */
export class FeishuChannel extends BaseRuntimeChatChannel {
  readonly name = "feishu" as const;
  private readonly appId?: string;
  private readonly appSecret?: string;
  private readonly domain?: string;

  constructor(options: FeishuChannelOptions = {}) {
    super(options);
    this.appId = String(options.appId || "").trim() || undefined;
    this.appSecret = String(options.appSecret || "").trim() || undefined;
    this.domain = String(options.domain || "").trim() || undefined;
  }

  getAccount(
    _context: PluginContext,
    account_store?: ChatChannelAccountStore,
  ): StoredChannelAccount | null {
    const storedAccount = this.getStoredAccount(account_store);
    if (storedAccount) return storedAccount;

    const appId = String(this.appId || this.env.FEISHU_APP_ID || "").trim();
    const appSecret = String(
      this.appSecret || this.env.FEISHU_APP_SECRET || "",
    ).trim();
    const domain = String(this.domain || this.env.FEISHU_DOMAIN || "").trim();
    if (!appId || !appSecret) return null;
    const now = this.nowIso();
    return {
      id: this.channelAccountId || "chat-sdk-feishu",
      channel: "feishu",
      name: this.display_name || "feishu",
      appId,
      appSecret,
      ...(domain ? { domain } : {}),
      created_at: now,
      updated_at: now,
    };
  }
}

/**
 * QQ channel 配置。
 */
export interface QqChannelOptions extends BaseChatChannelOptions {
  /**
   * QQ Bot App ID。
   */
  appId?: string;
  /**
   * QQ Bot App Secret。
   */
  appSecret?: string;
  /**
   * 是否使用 QQ 沙箱模式。
   */
  sandbox?: boolean;
}

/**
 * QQ channel。
 */
export class QqChannel extends BaseRuntimeChatChannel {
  readonly name = "qq" as const;
  private readonly appId?: string;
  private readonly appSecret?: string;
  private readonly sandbox?: boolean;

  constructor(options: QqChannelOptions = {}) {
    super(options);
    this.appId = String(options.appId || "").trim() || undefined;
    this.appSecret = String(options.appSecret || "").trim() || undefined;
    this.sandbox = options.sandbox === true;
  }

  getAccount(
    _context: PluginContext,
    account_store?: ChatChannelAccountStore,
  ): StoredChannelAccount | null {
    const storedAccount = this.getStoredAccount(account_store);
    if (storedAccount) return storedAccount;

    const appId = String(this.appId || this.env.QQ_APP_ID || "").trim();
    const appSecret = String(this.appSecret || this.env.QQ_APP_SECRET || "").trim();
    const sandbox =
      this.sandbox === true ||
      String(this.env.QQ_SANDBOX || "").trim().toLowerCase() === "true";
    if (!appId || !appSecret) return null;
    const now = this.nowIso();
    return {
      id: this.channelAccountId || "chat-sdk-qq",
      channel: "qq",
      name: this.display_name || "qq",
      appId,
      appSecret,
      ...(sandbox ? { sandbox: true } : {}),
      created_at: now,
      updated_at: now,
    };
  }
}
