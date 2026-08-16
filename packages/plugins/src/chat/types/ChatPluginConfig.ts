/** Chat Plugin 的完整 profile 类型。 */

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

/** Chat Plugin 的完整结构化 profile。 */
export interface ChatPluginConfig {
  /** 可选的消息队列与合并策略。 */
  queue?: ChatPluginQueueConfig;
  /** 当前 profile 拥有的消息渠道。 */
  channels?: ChatPluginChannelConfig[];
}
