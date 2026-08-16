/**
 * ChatPlugin SDK / runtime 配置类型。
 *
 * 关键点（中文）
 * - ChatPlugin 只接收 queue 行为与 channels 列表。
 * - 每个 channel 对象自己负责 env、凭据与运行账号解析。
 * - 这样 ChatPlugin 不再理解 Telegram、Feishu、QQ 的具体配置字段。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";
import type { ChatQueueWorkerConfig } from "@/chat/types/ChatQueueWorker.js";
import type { ChatRuntimeAccount } from "@/chat/types/ChatRuntimeAccount.js";

/**
 * Chat channel 对象协议。
 */
export interface ChatChannel {
  /**
   * channel 名称。
   */
  readonly name: ChatChannelName;
  /**
   * 当前 channel 是否启用。
   */
  isEnabled(context: PluginContext): boolean;
  /**
   * 当前 channel 的稳定 ID。
   */
  get_channel_id(context: PluginContext): string;
  /**
   * 解析当前 channel 的运行态账号。
   */
  getAccount(context: PluginContext): ChatRuntimeAccount | null;
}

/**
 * ChatPlugin 显式构造参数。
 */
export interface ChatPluginOptions {
  /**
   * Chat queue worker 运行配置。
   *
   * 说明（中文）
   * - 可用于不同 client 定制并发、突发合并等行为。
   * - 这是 queue 行为的唯一运行配置入口。
   */
  queue?: Partial<ChatQueueWorkerConfig>;
  /**
   * 当前 agent 持有的 chat channels。
   *
   * 说明（中文）
   * - 每个 channel 对象自己负责 env、凭据与运行账号解析。
   * - 未传入时不启用任何 chat channel。
   */
  channels?: ChatChannel[];
}
