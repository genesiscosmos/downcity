/**
 * Downcity 配置类型定义。
 *
 * 关键点（中文）
 * - 该配置只属于 CLI/City 控制面，不进入 Agent SDK。
 * - Agent 只接收宿主已经装配好的 Workspace、Model 与 Plugin 实例。
 */
import type { JsonObject } from "@downcity/agent";
import type { LlmConfig } from "@/city/types/config/LlmConfig.js";
import type { ExecutionBindingConfig } from "@/city/types/config/ExecutionBinding.js";

/**
 * 单个聊天渠道配置。
 */
export interface DowncityChatChannelConfig {
  /**
   * 当前渠道是否启用。
   */
  enabled?: boolean;
  /**
   * 绑定的渠道账户 ID。
   */
  channelAccountId?: string;
}

/**
 * 聊天插件渠道配置集合。
 */
export interface DowncityChatPluginChannelsConfig {
  /**
   * Telegram 渠道配置。
   */
  telegram?: DowncityChatChannelConfig;
  /**
   * Feishu 渠道配置。
   */
  feishu?: DowncityChatChannelConfig;
  /**
   * QQ 渠道配置。
   */
  qq?: DowncityChatChannelConfig;
}

/**
 * 聊天插件队列配置。
 */
export interface DowncityChatPluginQueueConfig {
  /**
   * 全局最大并发（不同 chat_key 之间）。
   * 默认：2
   */
  maxConcurrency?: number;
  /**
   * 入站消息合并的防抖窗口（毫秒）。
   *
   * 关键点（中文）
   * - 同一 chat_key 在该窗口内连续到达的多条消息，会在一次 run 前一起并入上下文。
   * - 典型场景：用户先发一句话，再紧接着转发链接/卡片。
   * - 设为 `0` 或负数可关闭该能力（立即执行首条消息）。
   *
   * 默认：600
   */
  mergeDebounceMs?: number;
  /**
   * 入站消息合并的最长等待时间（毫秒）。
   *
   * 关键点（中文）
   * - 即使用户持续发送新消息，也不会无限延期；达到该上限后会立刻启动 run。
   * - 用于平衡“尽量合并上下文”与“响应时延可控”。
   * - 当 `mergeDebounceMs <= 0` 时该字段不会生效。
   *
   * 默认：2000
   */
  mergeMaxWaitMs?: number;
}

/**
 * 聊天插件配置。
 */
export interface DowncityChatPluginConfig {
  /**
   * Chat 调度队列（按 chat_key 分 lane）。
   */
  queue?: DowncityChatPluginQueueConfig;
  /**
   * 消息平台 channel 配置。
   */
  channels?: DowncityChatPluginChannelsConfig;
}

/**
 * Agent 全局配置中的插件配置映射。
 */
export interface DowncityPluginConfigMap {
  /**
   * chat 插件配置。
   */
  chat?: DowncityChatPluginConfig;
  /**
   * 其他插件配置。
   */
  [plugin_name: string]:
    | JsonObject
    | DowncityChatPluginConfig
    | undefined;
}

export interface DowncityConfig {
  /**
   * agent 唯一标识。
   *
   * 关键点（中文）
   * - `@downcity/agent` 只关心稳定标识，不承担展示名语义。
   * - 该字段同时用于 session/runtime/storage 目录归属。
   */
  id: string;
  version: string;
  /**
   * Runtime startup configuration used by `downcity agent start`.
   * CLI flags (if provided) take precedence over this config.
   */
  start?: {
    port?: number;
    host?: string;
  };
  /**
   * Plugin 宿主配置视图。
   *
   * 关键点（中文）
   * - 所有可配置能力统一收敛到 `plugins`，不再保留独立 `services` 域。
   * - 该字段只用于宿主内部装配视图；持久化值位于全局数据库 `agent_plugins` Binding。
   * - key 为 plugin 名称，value 为对应插件的结构化配置对象。
   * - 当前阶段允许各 plugin 自定义字段，但必须保持 JSON 可序列化。
   */
  plugins?: DowncityPluginConfigMap;
  /**
   * 项目执行绑定配置。
   *
   * 关键点（中文）
   * - 项目只有一种执行模式：`api`。
   * - 绑定 City AIService 暴露的模型 ID。
   */
  execution?: ExecutionBindingConfig;
  /**
   * LLM 全量配置（通常来自平台全局层合并结果）。
   *
   * 关键点（中文）
   * - `@downcity/agent` 本地 SDK 不直接消费该字段。
   * - 宿主侧（例如 `downcity`）可读取该字段控制模型工厂行为，例如 `llm.logMessages`。
   * - 该字段通常由宿主平台装配，不由 Agent SDK 解析。
   */
  llm?: LlmConfig;
}
