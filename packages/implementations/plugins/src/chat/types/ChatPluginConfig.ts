/** Chat Plugin 的完整 City 级配置类型。 */

import type { ChatPluginChannelConfig } from "@/chat/types/ChatPluginChannelConfig.js";

/** Chat 消息队列与合并策略。 */
export interface ChatPluginQueueConfig {
  /** 同时执行的最大 Chat lane 数。 */
  max_concurrency?: number;
  /** 合并连续入站消息的防抖窗口，单位为毫秒。 */
  merge_debounce_ms?: number;
  /** 入站消息等待合并的最长时间，单位为毫秒。 */
  merge_max_wait_ms?: number;
}

/** Chat Plugin 的完整结构化配置。 */
export interface ChatPluginConfig {
  /** 唯一接收入站消息的 Agent；配置 Channel 时必须提供。 */
  owner_agent_id?: string;
  /** 唯一承载渠道 Session 与附件的 Workspace；配置 Channel 时必须提供。 */
  owner_workspace_id?: string;
  /** 可选的消息队列与合并策略。 */
  queue?: ChatPluginQueueConfig;
  /** 当前 Plugin 配置拥有的消息渠道。 */
  channels?: ChatPluginChannelConfig[];
}
