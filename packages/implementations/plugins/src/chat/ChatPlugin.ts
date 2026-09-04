/**
 * ChatPlugin：chat plugin 的类实现。
 *
 * 关键点（中文）
 * - chat 的渠道 bot 状态归属于 ChatPlugin 实例。
 * - chat 的 queue worker 也归属于 ChatPlugin 实例，而不是 agent 入口。
 * - Index 只保留静态导出入口，这里承接真正的 plugin class 实现。
 * - action 注册表已经拆到独立模块，当前文件只保留实例骨架。
 */

import { BasePlugin } from "@downcity/city/plugin";
import type { PluginActions } from "@downcity/city/plugin";
import type { PluginContext } from "@downcity/city/plugin";
import type { PluginExecutionContext } from "@downcity/city/plugin";
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

  /** 当前 Profile 唯一的渠道与队列运行态。 */
  private runtime: ChatWorkspaceRuntime | null = null;

  /** 当前 Profile 渠道绑定的 Agent/Workspace 作用域。 */
  private runtime_scope_key: string | null = null;

  /** 当前 Profile 唯一的渠道启动流程。 */
  private start_promise: Promise<void> | null = null;

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
    if (!this.is_owner_scope(context)) return;
    const scope_key = chat_scope_key(context);
    if (this.runtime) {
      if (this.runtime_scope_key !== scope_key) {
        throw new Error(
          "Chat Profile requires owner_agent_id and owner_workspace_id before it can bind multiple execution scopes",
        );
      }
      return;
    }
    if (this.start_promise) return await this.start_promise;
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
      this.runtime = {
        channel_state,
        queue_store,
        queue_worker: worker,
      };
      this.runtime_scope_key = scope_key;
      try {
        await startChatChannels(channel_state, context);
      } catch (error) {
        this.runtime = null;
        this.runtime_scope_key = null;
        worker.stop();
        await stopChatChannels(channel_state);
        throw error;
      }
    })();
    this.start_promise = start_promise;
    try {
      await start_promise;
    } finally {
      if (this.start_promise === start_promise) this.start_promise = null;
    }
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
      start: async () => {},
      bind: async (context) => {
        await this.start_workspace_runtime(context);
      },
      unbind: async (context) => {
        if (this.runtime_scope_key === chat_scope_key(context)) {
          await this.stop_runtime();
        }
      },
      stop: async () => {
        await this.start_promise?.catch(() => undefined);
        await this.stop_runtime();
      },
    };
  }

  /** 读取当前 Profile 的唯一渠道状态。 */
  private resolve_channel_state(_context: PluginContext): ChatChannelState {
    if (!this.runtime) throw new Error("Chat Profile channel runtime is not bound");
    return this.runtime.channel_state;
  }

  /** 向 chat 入队路径暴露当前 Profile 的唯一队列。 */
  queue_store(_context: PluginContext): ChatQueueStore {
    if (!this.runtime) throw new Error("Chat Profile queue runtime is not bound");
    return this.runtime.queue_store;
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

  /** 判断当前 Context 是否是 Profile 指定的唯一入站作用域。 */
  private is_owner_scope(context: PluginContext): boolean {
    const owner_agent_id = String(this.options.owner_agent_id || "").trim();
    const owner_workspace_id = String(this.options.owner_workspace_id || "").trim();
    if (owner_agent_id && owner_agent_id !== context.agent.id) return false;
    if (owner_workspace_id && owner_workspace_id !== context.workspace.id) return false;
    return true;
  }

  /** 停止当前 Profile 唯一的渠道与队列资源。 */
  private async stop_runtime(): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) return;
    this.runtime = null;
    this.runtime_scope_key = null;
    runtime.queue_worker.stop();
    await stopChatChannels(runtime.channel_state);
  }
}

/** 返回 Chat Profile 中唯一的 Agent/Workspace 作用域键。 */
function chat_scope_key(context: PluginContext): string {
  return `${context.agent.id}\u0000${context.workspace.id}`;
}
