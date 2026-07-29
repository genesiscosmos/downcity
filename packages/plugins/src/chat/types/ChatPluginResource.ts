/**
 * Chat Plugin Resource 类型。
 *
 * 关键点（中文）
 * - Resource 是 City 解析后传给 Chat Plugin Factory 的完整配置对象。
 * - `id` 是稳定本地身份，`type` 是渠道判别字段，`name` 等只读字段由 Resolver 写入。
 * - 凭据仍属于完整 Resource Item，但 CLI 展示时必须根据 Schema 的 `writeOnly` 注解脱敏。
 */

/** Telegram Bot Resource。 */
export interface TelegramPluginResource {
  /** CLI 生成的稳定 Resource ID。 */
  id: string;

  /** Telegram Resource 判别字段。 */
  type: "telegram";

  /** Resolver 获取的 Bot 真实名称。 */
  name: string;

  /** Telegram Bot API Token。 */
  bot_token: string;

  /** Resolver 获取的 Telegram username。 */
  username?: string;

  /** Resolver 获取的 Telegram Bot 用户 ID。 */
  bot_user_id?: string;
}

/** Feishu / Lark Bot Resource。 */
export interface FeishuPluginResource {
  /** CLI 生成的稳定 Resource ID。 */
  id: string;

  /** Feishu Resource 判别字段。 */
  type: "feishu";

  /** Resolver 获取的 Bot 真实名称。 */
  name: string;

  /** Feishu / Lark App ID。 */
  app_id: string;

  /** Feishu / Lark App Secret。 */
  app_secret: string;

  /** 可选 Open API Domain。 */
  domain?: string;

  /** Resolver 获取的 Bot 身份。 */
  identity?: string;

  /** Resolver 获取的所有者名称。 */
  owner?: string;

  /** Resolver 获取的创建者名称。 */
  creator?: string;

  /** Resolver 获取的 Bot 用户 ID。 */
  bot_user_id?: string;
}

/** QQ Bot Resource。 */
export interface QqPluginResource {
  /** CLI 生成的稳定 Resource ID。 */
  id: string;

  /** QQ Resource 判别字段。 */
  type: "qq";

  /** Resolver 获取的 Bot 真实名称。 */
  name: string;

  /** QQ Bot App ID。 */
  app_id: string;

  /** QQ Bot App Secret。 */
  app_secret: string;

  /** 是否使用 QQ 沙箱环境。 */
  sandbox?: boolean;

  /** Resolver 获取的 Bot 身份。 */
  identity?: string;

  /** Resolver 获取的 Bot 用户 ID。 */
  bot_user_id?: string;
}

/** Chat Plugin 支持的完整 Resource Item。 */
export type ChatPluginResource =
  | TelegramPluginResource
  | FeishuPluginResource
  | QqPluginResource;
