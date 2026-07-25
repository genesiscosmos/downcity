/**
 * ChatPlugin：chat plugin 的类实现。
 *
 * 关键点（中文）
 * - chat 的渠道 bot 状态归属于 ChatPlugin 实例。
 * - chat 的 queue worker 也归属于 ChatPlugin 实例，而不是 agent 入口。
 * - Index 只保留静态导出入口，这里承接真正的 plugin class 实现。
 * - action 注册表已经拆到独立模块，当前文件只保留实例骨架。
 */

import { BasePlugin } from "@downcity/agent";
import type { PluginActions } from "@downcity/agent";
import type { AgentContext } from "@downcity/agent";
import type { PluginRunContext } from "@downcity/agent";
import type { ChatChannelState } from "@/chat/types/ChatRuntime.js";
import type { ChatQueueWorkerConfig } from "@/chat/types/ChatQueueWorker.js";
import type {
  ChatChannel,
  ChatPluginOptions,
} from "@/chat/types/ChatPluginOptions.js";
import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";
import {
  FeishuChannel,
  QqChannel,
  TelegramChannel,
} from "@/chat/channels/RuntimeChannel.js";
import {
  createChatChannelState,
  startChatChannels,
  stopChatChannels,
} from "./runtime/ChatChannelFacade.js";
import { createChatPluginActions } from "./runtime/ChatPluginActions.js";
import { create_chat_access_actions } from "./access/ChatAccessActions.js";
import { ChatQueueWorker } from "./runtime/ChatQueueWorker.js";
import { buildChatPluginSystem } from "./runtime/ChatPluginSystem.js";
import { ChatQueueStore } from "./runtime/ChatQueueStore.js";

function createDefaultChannels(): ChatChannel[] {
  return [
    new TelegramChannel({ enabled: false }),
    new FeishuChannel({ enabled: false }),
    new QqChannel({ enabled: false }),
  ];
}

/**
 * Chat plugin 类实现。
 */
export class ChatPlugin extends BasePlugin {
  /**
   * plugin 名称。
   */
  readonly name = "chat";

  /**
   * 当前实例持有的渠道状态。
   */
  public readonly channelState: ChatChannelState = createChatChannelState();

  /**
   * 当前实例持有的 chat queue worker。
   *
   * 关键点（中文）
   * - worker 生命周期与 chat plugin 保持一致。
   * - 这样 agent 只负责装配，不直接持有 chat 领域长期状态。
   */
  public queueWorker: ChatQueueWorker | null = null;

  /**
   * 当前实例持有的 chat queue store。
   *
   * 关键点（中文）
   * - 这是 chat queue 状态的实例归属起点。
   * - 迁移完成后，入队路径也会统一走这里，而不是模块级全局 queue。
   */
  public readonly queueStore = new ChatQueueStore();

  /**
   * 当前实例持有的显式 plugin 配置。
   */
  public readonly options: ChatPluginOptions;

  /**
   * 当前实例持有的 chat channels。
   */
  public readonly channels: ChatChannel[];

  /**
   * 当前 plugin 的 system 文本构建器。
   */
  readonly system = async (
    context: AgentContext,
    run_context?: PluginRunContext,
  ): Promise<string> => {
    return await buildChatPluginSystem(context, run_context);
  };

  /**
   * 当前 plugin 的 action 定义表。
   */
  readonly actions: PluginActions;

  /**
   * 启动当前实例的 queue worker。
   */
  private startQueueWorker(context: AgentContext): void {
    if (this.queueWorker) return;
    const worker = new ChatQueueWorker({
      logger: context.logger,
      context,
      queueStore: this.queueStore,
      config: this.getQueueWorkerConfig(context),
    });
    worker.start();
    this.queueWorker = worker;
  }

  /**
   * 停止当前实例的 queue worker。
   */
  private stopQueueWorker(): void {
    const worker = this.queueWorker;
    this.queueWorker = null;
    if (!worker) return;
    worker.stop();
  }

  constructor(options?: ChatPluginOptions) {
    super();
    this.options = options || {};
    this.channels = Array.isArray(this.options.channels)
      ? [...this.options.channels]
      : createDefaultChannels();
    this.actions = {
      ...createChatPluginActions({
        channelState: this.channelState,
      }),
      ...create_chat_access_actions(),
    };
    this.lifecycle = {
      start: async (context) => {
        this.startQueueWorker(context);
        await startChatChannels(this.channelState, context);
      },
      stop: async () => {
        this.stopQueueWorker();
        await stopChatChannels(this.channelState);
      },
    };
  }

  /**
   * 读取 queue worker 配置。
   */
  getQueueWorkerConfig(
    context: AgentContext,
  ): Partial<ChatQueueWorkerConfig> | undefined {
    void context;
    return this.options.queue;
  }

  /**
   * 判断指定渠道是否启用。
   */
  isChannelEnabled(context: AgentContext, channel: ChatChannelName): boolean {
    return this.getChannel(channel)?.isEnabled(context) === true;
  }

  /**
   * 读取指定渠道的显式账户 ID。
   */
  getChannelAccountId(
    context: AgentContext,
    channel: ChatChannelName,
  ): string {
    return String(this.getChannel(channel)?.getChannelAccountId(context) || "").trim();
  }

  /**
   * 解析指定渠道当前应使用的账户。
   */
  resolveChannelAccount(
    context: AgentContext,
    channel: ChatChannelName,
  ) {
    return this.getChannel(channel)?.getAccount(
      context,
      this.options.account_store,
    ) || null;
  }

  private getChannel(channel: ChatChannelName): ChatChannel | null {
    return this.channels.find((item) => item.name === channel) || null;
  }
}
