/** Chat Bot Account 配置与 Desktop 投影类型。 */

/** Chat Plugin 支持的平台类型。 */
export type ChatProvider = "telegram" | "feishu";

/** 一个 Bot Account 的公共配置。 */
export interface ChatAccountBaseConfig {
  /** Bot Account 内部稳定 ID。 */
  account_id: string;
  /** 用户在 Desktop 中看到的名称。 */
  name: string;
  /** 当前账号所属平台。 */
  provider: ChatProvider;
  /** 是否在 City 启动后连接并处理消息。 */
  enabled: boolean;
  /**
   * 新 Conversation 默认路由到的 Agent。
   *
   * 说明（中文）
   * - 可选：仅作为新 Conversation 的初始绑定，不是 Account 的身份。
   * - 已有 Conversation 始终沿用自身记录的 agent_id，不受此处改动影响。
   * - 缺失时由 City 级默认 Agent 兜底。
   */
  agent_id?: string;
  /**
   * 新 Conversation 默认使用的 Workspace。
   *
   * 说明（中文）
   * - 可选：仅作为新 Conversation 的初始绑定。
   * - 已有 Conversation 始终沿用自身记录的 workspace_id。
   */
  workspace_id?: string;
}

/** Telegram Bot Account 配置。 */
export interface TelegramAccountConfig extends ChatAccountBaseConfig {
  /** 当前账号的平台类型。 */
  provider: "telegram";
  /** Telegram Bot API Token。 */
  bot_token: string;
}

/** Feishu/Lark Bot Account 配置。 */
export interface FeishuAccountConfig extends ChatAccountBaseConfig {
  /** 当前账号的平台类型。 */
  provider: "feishu";
  /** Feishu/Lark App ID。 */
  app_id: string;
  /** Feishu/Lark App Secret。 */
  app_secret: string;
  /** Open API 域名。 */
  domain?: string;
}

/** Chat Plugin 持久化的一个 Bot Account 配置。 */
export type ChatAccountConfig =
  | TelegramAccountConfig
  | FeishuAccountConfig;

/** Chat Plugin 唯一配置。 */
export interface ChatAccountsConfig {
  /** 当前 City 中配置的全部 Bot Account。 */
  accounts: ChatAccountConfig[];
}

/** Bot Connector 对 Desktop 暴露的连接状态。 */
export type ChatAccountConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error"
  | "disabled";

/** Desktop 可以读取的 Bot Account 安全投影。 */
export interface ChatAccountView {
  /** Bot Account 内部稳定 ID。 */
  account_id: string;
  /** 用户可见名称。 */
  name: string;
  /** 当前账号所属平台。 */
  provider: ChatProvider;
  /** 当前账号是否启用。 */
  enabled: boolean;
  /** 新 Conversation 默认使用的 Agent ID；未配置时省略。 */
  agent_id?: string;
  /** 新 Conversation 默认使用的 Workspace ID；未配置时省略。 */
  workspace_id?: string;
  /** 必需的平台凭据是否已经配置完整。 */
  credential_configured: boolean;
  /** 当前 Connector 状态。 */
  connection_state: ChatAccountConnectionState;
  /** 最近一次连接错误。 */
  last_error?: string;
  /** 非敏感平台设置中的 App ID。 */
  app_id?: string;
  /** Feishu/Lark Open API 域名。 */
  domain?: string;
}

/** Desktop 创建或更新 Bot Account 时提交的安全草稿。 */
export interface ChatAccountDraft {
  /** 更新时使用的 Bot Account ID；创建时可以省略。 */
  account_id?: string;
  /** 用户可见名称。 */
  name: string;
  /** 当前账号所属平台。 */
  provider: ChatProvider;
  /** 当前账号是否启用。 */
  enabled: boolean;
  /** 新 Conversation 默认使用的 Agent ID；可省略。 */
  agent_id?: string;
  /** 新 Conversation 默认使用的 Workspace ID；可省略。 */
  workspace_id?: string;
  /** Telegram Bot Token；更新时留空表示保留。 */
  bot_token?: string;
  /** Feishu App ID。 */
  app_id?: string;
  /** Feishu App Secret；更新时留空表示保留。 */
  app_secret?: string;
  /** Feishu/Lark Open API 域名。 */
  domain?: string;
}
