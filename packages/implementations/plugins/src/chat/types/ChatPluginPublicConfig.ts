/** Chat Plugin Config Renderer 使用的公开配置类型。 */

/** Renderer 可见的 Chat 队列配置。 */
export interface ChatPluginPublicQueueConfig {
  /** 同时处理的最大 Chat 任务数量。 */
  max_concurrency?: number;
  /** 合并连续入站消息前等待的毫秒数。 */
  merge_debounce_ms?: number;
  /** 一组入站消息允许等待合并的最大毫秒数。 */
  merge_max_wait_ms?: number;
}

/** Renderer 可见的单个 Chat Channel。 */
export interface ChatPluginPublicChannelConfig {
  /** Channel 在当前 Plugin 配置内的稳定 ID。 */
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

/** Renderer 可见的完整 Chat Plugin 配置。 */
export interface ChatPluginPublicConfig {
  /** 唯一接收入站消息的 Agent ID。 */
  owner_agent_id?: string;
  /** 唯一承载渠道 Session 与附件的 Workspace ID。 */
  owner_workspace_id?: string;
  /** Chat 队列行为。 */
  queue: ChatPluginPublicQueueConfig;
  /** 当前 Plugin 配置拥有的全部 Channel。 */
  channels: ChatPluginPublicChannelConfig[];
}
