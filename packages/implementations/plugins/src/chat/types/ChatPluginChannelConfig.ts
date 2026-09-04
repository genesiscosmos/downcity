/** Chat Plugin profile 中的渠道配置类型。 */

/** Telegram Bot 渠道配置。 */
export interface TelegramPluginChannelConfig {
  /** profile 内稳定渠道 ID。 */
  id: string;
  /** 渠道判别字段。 */
  type: "telegram";
  /** 用户可见渠道名称。 */
  name: string;
  /** Telegram Bot API Token。 */
  bot_token: string;
  /** 可选 Telegram username。 */
  username?: string;
  /** 可选 Telegram Bot 用户 ID。 */
  bot_user_id?: string;
}

/** Feishu / Lark Bot 渠道配置。 */
export interface FeishuPluginChannelConfig {
  /** profile 内稳定渠道 ID。 */
  id: string;
  /** 渠道判别字段。 */
  type: "feishu";
  /** 用户可见渠道名称。 */
  name: string;
  /** Feishu / Lark App ID。 */
  app_id: string;
  /** Feishu / Lark App Secret。 */
  app_secret: string;
  /** 可选 Open API Domain。 */
  domain?: string;
  /** 可选 Bot 身份。 */
  identity?: string;
  /** 可选 Bot 用户 ID。 */
  bot_user_id?: string;
}

/** QQ Bot 渠道配置。 */
export interface QqPluginChannelConfig {
  /** profile 内稳定渠道 ID。 */
  id: string;
  /** 渠道判别字段。 */
  type: "qq";
  /** 用户可见渠道名称。 */
  name: string;
  /** QQ Bot App ID。 */
  app_id: string;
  /** QQ Bot App Secret。 */
  app_secret: string;
  /** 是否使用 QQ 沙箱环境。 */
  sandbox?: boolean;
  /** 可选 Bot 身份。 */
  identity?: string;
  /** 可选 Bot 用户 ID。 */
  bot_user_id?: string;
}

/** Chat Plugin profile 支持的完整渠道配置。 */
export type ChatPluginChannelConfig =
  | TelegramPluginChannelConfig
  | FeishuPluginChannelConfig
  | QqPluginChannelConfig;
