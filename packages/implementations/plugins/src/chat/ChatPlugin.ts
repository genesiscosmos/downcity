/**
 * ChatPlugin：chat plugin 的类实现。
 *
 * 关键点（中文）
 * - chat 的渠道 bot 状态归属于 ChatPlugin 实例。
 * - chat 的 queue worker 也归属于 ChatPlugin 实例，而不是 agent 入口。
 * - Index 只保留静态导出入口，这里承接真正的 plugin class 实现。
 * - action 注册表已经拆到独立模块，当前文件只保留实例骨架。
 */

import { Plugin } from "@downcity/city/plugin";
import type { PluginActions } from "@downcity/city/plugin";
import type { PluginContext, PluginLifecycleContext } from "@downcity/city/plugin";
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
import type { ChatPluginConfig } from "@/chat/types/ChatPluginConfig.js";
import type { ChatPluginChannelConfig } from "@/chat/types/ChatPluginChannelConfig.js";
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
import { register_chat_plugin_host_actions } from "@/chat/host/ChatPluginHostActions.js";

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
export class ChatPlugin extends Plugin {
  /**
   * plugin 名称。
   */
  readonly name = "chat";

  /** Plugin 用户可见标题。 */
  readonly title = "Chat";

  /** Plugin 用户可见说明。 */
  readonly description = "Connects Agents to Telegram, Feishu, and QQ channels.";

  /** 当前 City 配置对应的唯一渠道与队列运行态。 */
  private runtime?: {
    /** Chat 渠道与队列运行对象。 */ readonly value: ChatWorkspaceRuntime;
    /** 按当前配置解析出的渠道实例。 */ readonly channels: ChatChannel[];
  };

  /** 唯一 Chat runtime 正在进行的启动流程。 */
  private start_promise?: Promise<void>;

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
    await this.start_workspace_runtime(context);
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
    if (this.runtime) return;
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
        value: {
          channel_state,
          queue_store,
          queue_worker: worker,
        },
        channels: this.create_configured_channels(context),
      };
      try {
        await startChatChannels(channel_state, context);
      } catch (error) {
        this.runtime = undefined;
        worker.stop();
        await stopChatChannels(channel_state);
        throw error;
      }
    })();
    this.start_promise = start_promise;
    try {
      await start_promise;
    } finally {
      if (this.start_promise === start_promise) this.start_promise = undefined;
    }
  }

  constructor(options?: ChatPluginOptions) {
    super();
    this.options = options || {};
    this.channels = Array.isArray(this.options.channels)
      ? [...this.options.channels]
      : createDefaultChannels();
    this.actions = this.with_runtime({
      ...createChatPluginActions({
        resolve_channel_state: (context) => this.resolve_channel_state(context),
      }),
      ...create_chat_access_actions(),
    });
  }

  /** 注册宿主配置 actions。 */
  initialize(context: PluginLifecycleContext): void {
    register_chat_plugin_host_actions(context, async () => await this.stop_runtime());
  }

  /** 释放当前 Plugin 实例持有的全部 Chat runtime。 */
  async dispose(): Promise<void> {
    await this.stop_runtime();
  }

  /** 让依赖实时渠道的 Chat Action 在执行前惰性确保领域运行时存在。 */
  private with_runtime(actions: PluginActions): PluginActions {
    const runtime_action_ids = new Set(["status", "test", "reconnect", "send", "react"]);
    return Object.fromEntries(Object.entries(actions).map(([action_id, action]) => [
      action_id,
      {
        ...action,
        execute: async (input) => {
          if (runtime_action_ids.has(action_id)) {
            await this.start_workspace_runtime(input.context);
          }
          return await action.execute(input);
        },
      },
    ]));
  }

  /** 读取当前 City 配置的唯一渠道状态。 */
  private resolve_channel_state(_context: PluginContext): ChatChannelState {
    if (!this.runtime) throw new Error("Chat channel runtime is not active");
    return this.runtime.value.channel_state;
  }

  /** 向 Chat 入队路径暴露当前 City 配置的唯一队列。 */
  queue_store(_context: PluginContext): ChatQueueStore {
    if (!this.runtime) throw new Error("Chat queue runtime is not active");
    return this.runtime.value.queue_store;
  }

  /**
   * 读取 queue worker 配置。
   */
  getQueueWorkerConfig(
    context: PluginContext,
  ): Partial<ChatQueueWorkerConfig> | undefined {
    return this.resolve_config(context).queue ?? this.options.queue;
  }

  /**
   * 判断指定渠道是否启用。
   */
  isChannelEnabled(context: PluginContext, channel: ChatChannelName): boolean {
    return this.get_channel(context, channel)?.isEnabled(context) === true;
  }

  /**
   * 读取指定渠道的显式账户 ID。
   */
  get_channel_id(
    context: PluginContext,
    channel: ChatChannelName,
  ): string {
    return String(this.get_channel(context, channel)?.get_channel_id(context) || "").trim();
  }

  /**
   * 解析指定渠道当前应使用的账户。
   */
  resolveChannelAccount(
    context: PluginContext,
    channel: ChatChannelName,
  ) {
    return this.get_channel(context, channel)?.getAccount(context) || null;
  }

  private get_channel(context: PluginContext, channel: ChatChannelName): ChatChannel | null {
    return this.resolve_channels(context).find((item) => item.name === channel) || null;
  }

  /** 判断当前 Context 是否是配置指定的唯一入站作用域。 */
  private is_owner_scope(context: PluginContext): boolean {
    const config = this.resolve_config(context);
    const owner_agent_id = String(config.owner_agent_id || this.options.owner_agent_id || "").trim();
    const owner_workspace_id = String(config.owner_workspace_id || this.options.owner_workspace_id || "").trim();
    if (owner_agent_id && owner_agent_id !== context.agent.id) return false;
    if (owner_workspace_id && owner_workspace_id !== context.workspace.id) return false;
    return true;
  }

  /** 停止当前配置创建的唯一渠道与队列资源。 */
  private async stop_runtime(): Promise<void> {
    await this.start_promise?.catch(() => undefined);
    const runtime = this.runtime?.value;
    if (!runtime) return;
    this.runtime = undefined;
    runtime.queue_worker.stop();
    await stopChatChannels(runtime.channel_state);
  }

  /** 解析 City 持有的序列化 Chat 配置。 */
  private resolve_config(context: PluginContext): ChatPluginConfig {
    return (context.config ?? {}) as unknown as ChatPluginConfig;
  }

  /** 返回当前配置的渠道实例。 */
  private resolve_channels(context: PluginContext): ChatChannel[] {
    if (this.runtime) return this.runtime.channels;
    return this.create_configured_channels(context);
  }

  /** 按当前配置创建渠道实例。 */
  private create_configured_channels(context: PluginContext): ChatChannel[] {
    if (Array.isArray(this.options.channels)) return this.channels;
    return create_configured_channels(this.resolve_config(context).channels ?? []);
  }
}

/** 把 JSON 渠道配置转换为当前作用域的运行对象。 */
function create_configured_channels(configs: ChatPluginChannelConfig[]): ChatChannel[] {
  const channel_types = new Set<string>();
  return configs.map((config) => {
    if (channel_types.has(config.type)) {
      throw new Error(`Chat Plugin channel type is duplicated: ${config.type}`);
    }
    channel_types.add(config.type);
    if (config.type === "telegram") {
      return new TelegramChannel({
        id: config.id,
        name: config.name,
        bot_token: config.bot_token,
      });
    }
    if (config.type === "feishu") {
      return new FeishuChannel({
        id: config.id,
        name: config.name,
        app_id: config.app_id,
        app_secret: config.app_secret,
        domain: config.domain,
      });
    }
    return new QqChannel({
      id: config.id,
      name: config.name,
      app_id: config.app_id,
      app_secret: config.app_secret,
      sandbox: config.sandbox,
    });
  });
}
