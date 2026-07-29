/**
 * Chat channel SDK 基类与内置 channel 实现。
 *
 * 关键点（中文）
 * - channel 对象是 ChatPlugin 的运行态配置单元。
 * - env 由 channel 自己读取，ChatPlugin 不理解平台字段。
 * - Resource 已由宿主解析为构造参数，channel 不访问账号池或其他外部 Store。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";
import type { ChatChannel } from "@/chat/types/ChatPluginOptions.js";
import type { ChatRuntimeAccount } from "@/chat/types/ChatRuntimeAccount.js";

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
   * Resource 或 SDK 调用方提供的稳定 ID。
   */
  id?: string;
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
  protected resource_id: string;
  protected display_name: string;

  protected constructor(options: BaseChatChannelOptions = {}) {
    this.enabled = options.enabled !== false;
    this.env = options.env || {};
    this.resource_id = String(options.id || "").trim();
    this.display_name = String(options.name || "").trim();
  }

  isEnabled(_context: PluginContext): boolean {
    return this.enabled;
  }

  getResourceId(_context: PluginContext): string {
    return this.resource_id;
  }

  protected nowIso(): string {
    return new Date().toISOString();
  }

  abstract getAccount(context: PluginContext): ChatRuntimeAccount | null;
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
  bot_token?: string;
}

/**
 * Telegram channel。
 */
export class TelegramChannel extends BaseRuntimeChatChannel {
  readonly name = "telegram" as const;
  private readonly bot_token?: string;

  constructor(options: TelegramChannelOptions = {}) {
    super(options);
    this.bot_token = String(options.bot_token || "").trim() || undefined;
  }

  getAccount(_context: PluginContext): ChatRuntimeAccount | null {
    const token = String(this.bot_token || this.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!token) return null;
    const now = this.nowIso();
    return {
      id: this.resource_id || "chat-sdk-telegram",
      channel: "telegram",
      name: this.display_name || "telegram",
      bot_token: token,
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
  app_id?: string;
  /**
   * Feishu / Lark App Secret。
   */
  app_secret?: string;
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
  private readonly app_id?: string;
  private readonly app_secret?: string;
  private readonly domain?: string;

  constructor(options: FeishuChannelOptions = {}) {
    super(options);
    this.app_id = String(options.app_id || "").trim() || undefined;
    this.app_secret = String(options.app_secret || "").trim() || undefined;
    this.domain = String(options.domain || "").trim() || undefined;
  }

  getAccount(_context: PluginContext): ChatRuntimeAccount | null {
    const appId = String(this.app_id || this.env.FEISHU_APP_ID || "").trim();
    const appSecret = String(
      this.app_secret || this.env.FEISHU_APP_SECRET || "",
    ).trim();
    const domain = String(this.domain || this.env.FEISHU_DOMAIN || "").trim();
    if (!appId || !appSecret) return null;
    const now = this.nowIso();
    return {
      id: this.resource_id || "chat-sdk-feishu",
      channel: "feishu",
      name: this.display_name || "feishu",
      app_id: appId,
      app_secret: appSecret,
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
  app_id?: string;
  /**
   * QQ Bot App Secret。
   */
  app_secret?: string;
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
  private readonly app_id?: string;
  private readonly app_secret?: string;
  private readonly sandbox?: boolean;

  constructor(options: QqChannelOptions = {}) {
    super(options);
    this.app_id = String(options.app_id || "").trim() || undefined;
    this.app_secret = String(options.app_secret || "").trim() || undefined;
    this.sandbox = options.sandbox === true;
  }

  getAccount(_context: PluginContext): ChatRuntimeAccount | null {
    const appId = String(this.app_id || this.env.QQ_APP_ID || "").trim();
    const appSecret = String(this.app_secret || this.env.QQ_APP_SECRET || "").trim();
    const sandbox =
      this.sandbox === true ||
      String(this.env.QQ_SANDBOX || "").trim().toLowerCase() === "true";
    if (!appId || !appSecret) return null;
    const now = this.nowIso();
    return {
      id: this.resource_id || "chat-sdk-qq",
      channel: "qq",
      name: this.display_name || "qq",
      app_id: appId,
      app_secret: appSecret,
      ...(sandbox ? { sandbox: true } : {}),
      created_at: now,
      updated_at: now,
    };
  }
}
