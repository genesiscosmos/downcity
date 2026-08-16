/**
 * ChatRuntime 类型定义。
 *
 * 关键点（中文）
 * - 这些类型描述 chat plugin runtime 的实例级运行态。
 * - channel bots 的状态所有权归属于 `ChatPlugin` 实例，而不是模块级单例。
 */

import type { FeishuBot } from "@/chat/channels/feishu/Feishu.js";
import type { QQBot } from "@/chat/channels/qq/QQ.js";
import type { TelegramBot } from "@/chat/channels/telegram/Bot.js";
import type { ChatQueueWorker } from "@/chat/runtime/ChatQueueWorker.js";
import type { ChatQueueStore } from "@/chat/runtime/ChatQueueStore.js";

/**
 * `ChatPlugin` 实例持有的渠道状态。
 *
 * 关键点（中文）
 * - 这里显式把 3 个内建渠道拆成独立槽位，避免继续使用弱类型 map。
 * - 未初始化的渠道统一为 `null`，不使用 `undefined`。
 */
export type ChatChannelState = {
  /**
   * Telegram 渠道 bot 实例。
   */
  telegram: TelegramBot | null;
  /**
   * Feishu 渠道 bot 实例。
   */
  feishu: FeishuBot | null;
  /**
   * QQ 渠道 bot 实例。
   */
  qq: QQBot | null;
};

/** ChatPlugin 在单个 Workspace 中持有的全部长期运行态。 */
export interface ChatWorkspaceRuntime {
  /** 当前 Workspace 的渠道连接状态。 */
  readonly channel_state: ChatChannelState;

  /** 当前 Workspace 的消息队列存储。 */
  readonly queue_store: ChatQueueStore;

  /** 当前 Workspace 的消息队列消费 worker。 */
  readonly queue_worker: ChatQueueWorker;
}
