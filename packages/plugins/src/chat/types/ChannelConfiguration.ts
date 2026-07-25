/**
 * Chat 渠道配置元信息类型。
 *
 * 关键点（中文）
 * - 每个 channel 通过统一结构声明“需要哪些参数、类型、描述、来源”。
 * - 该结构用于 Console / DB / CLI 直接消费，不依赖硬编码字段。
 */

import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";

/**
 * 配置字段基础值类型。
 */
export type ChatChannelConfigurationPrimitive = string | number | boolean | null;

/**
 * 配置字段类型枚举。
 */
export type ChatChannelConfigurationFieldType =
  | "string"
  | "boolean"
  | "number"
  | "secret"
  | "enum";

/**
 * 配置字段来源枚举。
 */
export type ChatChannelConfigurationFieldSource =
  | "agent_config"
  | "bot_account"
  | "env_fallback";

/**
 * 枚举型字段可选项。
 */
export interface ChatChannelConfigurationFieldOption {
  /**
   * 枚举值（真实写入值）。
   */
  value: string;
  /**
   * 展示标签（用于 UI 下拉选项）。
   */
  label: string;
  /**
   * 选项说明（用于帮助用户理解差异）。
   */
  description: string;
}

/**
 * 单个配置字段描述。
 */
export interface ChatChannelConfigurationField {
  /**
   * 字段键名（例如 `channelAccountId`、`enabled`）。
   */
  key: string;
  /**
   * 字段展示名。
   */
  label: string;
  /**
   * 字段用途说明。
   */
  description: string;
  /**
   * 字段值类型。
   */
  type: ChatChannelConfigurationFieldType;
  /**
   * 字段值来源（Agent config / chat account / env fallback）。
   */
  source: ChatChannelConfigurationFieldSource;
  /**
   * 该字段是否必填。
   */
  required: boolean;
  /**
   * 字段是否允许 `null`（用于清空）。
   */
  nullable: boolean;
  /**
   * 是否允许上游产品写入。
   */
  writable: boolean;
  /**
   * 修改该字段后是否建议重载 channel。
   */
  restartRequired: boolean;
  /**
   * 默认值（可选）。
   */
  default_value?: ChatChannelConfigurationPrimitive;
  /**
   * 示例值（可选）。
   */
  example?: ChatChannelConfigurationPrimitive;
  /**
   * 枚举选项（仅 `type=enum` 时使用）。
   */
  options?: ChatChannelConfigurationFieldOption[];
}

/**
 * 单个渠道配置说明。
 */
export interface ChatChannelConfigurationDescriptor {
  /**
   * 渠道名称。
   */
  channel: ChatChannelName;
  /**
   * 配置卡片标题。
   */
  title: string;
  /**
   * 配置说明（面向用户）。
   */
  description: string;
  /**
   * 描述器版本号（便于 UI 做兼容升级）。
   */
  version: string;
  /**
   * 该渠道支持的写入动作能力。
   */
  capabilities: {
    /**
     * 是否支持启用/禁用开关。
     */
    canToggleEnabled: boolean;
    /**
     * 是否支持 chat account 绑定。
     */
    canBindChannelAccount: boolean;
    /**
     * 上游产品是否支持编辑该渠道配置。
     */
    canConfigure: boolean;
  };
  /**
   * 渠道配置字段集合（按来源分组）。
   */
  fields: {
    /**
     * Agent 全局配置可声明字段。
     */
    agent_config: ChatChannelConfigurationField[];
    /**
     * `channel_accounts` 字段。
     */
    channelAccount: ChatChannelConfigurationField[];
    /**
     * 环境变量回退字段。
     */
    envFallback: ChatChannelConfigurationField[];
  };
}
