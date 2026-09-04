/** Chat Plugin Mainview 使用的 Profile 公开配置类型。 */

/** Mainview 可见的 Chat 队列配置。 */
export interface ChatPluginPublicQueueConfig {
  /** 同时处理的最大 Chat 任务数量。 */
  max_concurrency?: number;

  /** 合并连续入站消息前等待的毫秒数。 */
  merge_debounce_ms?: number;

  /** 一组入站消息允许等待合并的最大毫秒数。 */
  merge_max_wait_ms?: number;
}

/** Mainview 可见的单个 Chat Channel。 */
export interface ChatPluginPublicChannelConfig {
  /** Channel 在当前 Profile 内的稳定 ID。 */
  id: string;

  /** Channel 类型。 */
  type: "telegram" | "feishu" | "qq";

  /** 用户可见名称。 */
  name: string;

  /** Telegram Bot Token；读取时不返回已有值。 */
  bot_token?: string;

  /** 飞书或 QQ App ID。 */
  app_id?: string;

  /** 飞书或 QQ App Secret；读取时不返回已有值。 */
  app_secret?: string;

  /** 飞书 API Domain。 */
  domain?: string;

  /** QQ 是否使用沙箱环境。 */
  sandbox?: boolean;

  /** 当前 Channel 是否已经保存凭据。 */
  secret_configured: boolean;
}

/** Mainview 可见的完整 Chat Profile。 */
export interface ChatPluginPublicProfile {
  /** 当前 Profile 唯一接收入站消息的 Agent。 */
  owner_agent_id?: string;

  /** 当前 Profile 唯一承载渠道会话的 Workspace。 */
  owner_workspace_id?: string;

  /** Chat 队列行为。 */
  queue: ChatPluginPublicQueueConfig;

  /** 当前 Profile 拥有的全部 Channel。 */
  channels: ChatPluginPublicChannelConfig[];
}
