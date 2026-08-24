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
import type { PluginContext, AgentPluginContext } from "@downcity/agent";
import type { PluginExecutionContext } from "@downcity/agent";
import type {
  ChatChannelState,
  ChatWorkspaceRuntime,
} from "@/chat/types/ChatRuntime.js";
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

  /** 各 Workspace 独立持有的渠道与队列运行态。 */
  private readonly runtimes_by_workspace = new Map<string, ChatWorkspaceRuntime>();

  /** 各 Workspace 当前唯一的懒启动流程，避免 system/action 并发重复连接渠道。 */
  private readonly starts_by_workspace = new Map<string, Promise<void>>();

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
    context: PluginContext,
    execution_context?: PluginExecutionContext,
  ): Promise<string> => {
    await this.ensure_workspace_runtime(context);
    return await buildChatPluginSystem(context, execution_context);
  };

  /**
   * 当前 plugin 的 action 定义表。
   */
  readonly actions: PluginActions;

  /**
   * 启动当前实例的 queue worker。
   */
  private async start_workspace_runtime(context: PluginContext): Promise<void> {
    if (this.runtimes_by_workspace.has(context.workspace_id)) return;
    const started = this.starts_by_workspace.get(context.workspace_id);
    if (started) return await started;
    const start_promise = (async () => {
      const channel_state = createChatChannelState();
      const queue_store = new ChatQueueStore();
      const worker = new ChatQueueWorker({
        logger: context.logger,
        context,
        queueStore: queue_store,
        config: this.getQueueWorkerConfig(context),
      });
      worker.start();
      this.runtimes_by_workspace.set(context.workspace_id, {
        channel_state,
        queue_store,
        queue_worker: worker,
      });
      try {
        await startChatChannels(channel_state, context);
      } catch (error) {
        this.runtimes_by_workspace.delete(context.workspace_id);
        worker.stop();
        await stopChatChannels(channel_state);
        throw error;
      }
    })();
    this.starts_by_workspace.set(context.workspace_id, start_promise);
    try {
      await start_promise;
    } finally {
      if (this.starts_by_workspace.get(context.workspace_id) === start_promise) {
        this.starts_by_workspace.delete(context.workspace_id);
      }
    }
  }

  /** 按当前 Workspace Context 懒启动 chat 运行态。 */
  private async ensure_workspace_runtime(context: PluginContext): Promise<ChatWorkspaceRuntime> {
    const existing = this.runtimes_by_workspace.get(context.workspace_id);
    if (existing) return existing;
    await this.start_workspace_runtime(context);
    const runtime = this.runtimes_by_workspace.get(context.workspace_id);
    if (!runtime) throw new Error(`ChatPlugin failed to start Workspace runtime: ${context.workspace_id}`);
    return runtime;
  }

  constructor(options?: ChatPluginOptions) {
    super();
    this.options = options || {};
    this.channels = Array.isArray(this.options.channels)
      ? [...this.options.channels]
      : createDefaultChannels();
    this.actions = {
      ...createChatPluginActions({
        resolve_channel_state: (context) => this.resolve_channel_state(context),
      }),
      ...create_chat_access_actions(),
    };
    this.lifecycle = {
      start: async (_context: AgentPluginContext) => {},
      stop: async (_context: AgentPluginContext) => {
        await Promise.allSettled([...this.starts_by_workspace.values()]);
        await Promise.all([...this.runtimes_by_workspace.values()].map(async (runtime) => {
          runtime.queue_worker.stop();
          await stopChatChannels(runtime.channel_state);
        }));
        this.runtimes_by_workspace.clear();
        this.starts_by_workspace.clear();
      },
    };
  }

  /** 读取当前 Workspace 的渠道状态。 */
  private resolve_channel_state(context: PluginContext): ChatChannelState {
    const runtime = this.runtimes_by_workspace.get(context.workspace_id);
    if (!runtime) {
      const channel_state = createChatChannelState();
      const queue_store = new ChatQueueStore();
      const worker = new ChatQueueWorker({
        logger: context.logger,
        context,
        queueStore: queue_store,
        config: this.getQueueWorkerConfig(context),
      });
      worker.start();
      const created = { channel_state, queue_store, queue_worker: worker } satisfies ChatWorkspaceRuntime;
      this.runtimes_by_workspace.set(context.workspace_id, created);
      void startChatChannels(channel_state, context).catch((error) => {
        context.logger.warn(`[chat] channel startup failed: ${String(error)}`);
      });
      return channel_state;
    }
    return runtime.channel_state;
  }

  /** 向 chat 入队路径暴露当前 Workspace 的独立队列。 */
  queue_store(context: PluginContext): ChatQueueStore {
    const runtime = this.runtimes_by_workspace.get(context.workspace_id);
    if (!runtime) {
      this.resolve_channel_state(context);
      return this.runtimes_by_workspace.get(context.workspace_id)!.queue_store;
    }
    return runtime.queue_store;
  }

  /**
   * 读取 queue worker 配置。
   */
  getQueueWorkerConfig(
    context: PluginContext,
  ): Partial<ChatQueueWorkerConfig> | undefined {
    void context;
    return this.options.queue;
  }

  /**
   * 判断指定渠道是否启用。
   */
  isChannelEnabled(context: PluginContext, channel: ChatChannelName): boolean {
    return this.getChannel(channel)?.isEnabled(context) === true;
  }

  /**
   * 读取指定渠道的显式账户 ID。
   */
  get_channel_id(
    context: PluginContext,
    channel: ChatChannelName,
  ): string {
    return String(this.getChannel(channel)?.get_channel_id(context) || "").trim();
  }

  /**
   * 解析指定渠道当前应使用的账户。
   */
  resolveChannelAccount(
    context: PluginContext,
    channel: ChatChannelName,
  ) {
    return this.getChannel(channel)?.getAccount(context) || null;
  }

  private getChannel(channel: ChatChannelName): ChatChannel | null {
    return this.channels.find((item) => item.name === channel) || null;
  }
}
