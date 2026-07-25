/**
 * Chat account 管理类型。
 *
 * 关键点（中文）
 * - 这些类型描述 agent 运行时内部的 chat account 管理输入输出。
 * - 凭据明文只允许出现在写入输入中，读取结果必须是脱敏后的安全视图。
 */

import type { StoredChannelAccountChannel } from "@/chat/types/ChannelAccountStore.js";

/**
 * 支持的 chat account 平台类型。
 */
export type ChatChannelAccountChannel = StoredChannelAccountChannel;

/**
 * Chat account 探测结果。
 */
export interface ChatChannelAccountProbeResult {
  /**
   * 账号所属 chat platform。
   */
  channel: ChatChannelAccountChannel;
  /**
   * 系统生成的账号 ID。
   */
  accountId: string;
  /**
   * 账号展示名称。
   */
  name: string;
  /**
   * 平台身份展示文案，例如 bot username 或 app id。
   */
  identity?: string;
  /**
   * 平台返回的所有者信息。
   */
  owner?: string;
  /**
   * 平台返回的创建者信息。
   */
  creator?: string;
  /**
   * 平台返回的 bot 用户 ID。
   */
  botUserId?: string;
  /**
   * 面向用户的探测结果说明。
   */
  message: string;
}

/**
 * Chat account 列表中的安全视图。
 */
export interface ChatChannelAccountListItem {
  /**
   * 账号 ID。
   */
  id: string;
  /**
   * 账号所属 chat platform。
   */
  channel: ChatChannelAccountChannel;
  /**
   * 账号展示名称。
   */
  name: string;
  /**
   * 平台身份展示文案。
   */
  identity?: string;
  /**
   * 平台所有者信息。
   */
  owner?: string;
  /**
   * 平台创建者信息。
   */
  creator?: string;
  /**
   * 渠道域名，例如 Feishu/Lark 域。
   */
  domain?: string;
  /**
   * QQ 沙箱模式开关。
   */
  sandbox: boolean;
  /**
   * 是否保存了 bot token。
   */
  hasBotToken: boolean;
  /**
   * 是否保存了 app id。
   */
  hasAppId: boolean;
  /**
   * 是否保存了 app secret。
   */
  hasAppSecret: boolean;
  /**
   * 脱敏后的 bot token。
   */
  botTokenMasked?: string;
  /**
   * 脱敏后的 app id。
   */
  appIdMasked?: string;
  /**
   * 脱敏后的 app secret。
   */
  appSecretMasked?: string;
  /**
   * 创建时间（ISO 字符串）。
   */
  createdAt: string;
  /**
   * 更新时间（ISO 字符串）。
   */
  updatedAt: string;
}

/**
 * Chat account 列表结果。
 */
export interface ChatChannelAccountListResult {
  /**
   * 脱敏后的账号列表。
   */
  items: ChatChannelAccountListItem[];
}

/**
 * Chat account 写入输入。
 */
export interface ChatChannelAccountUpsertInput {
  /**
   * 账号 ID。
   */
  id: string;
  /**
   * 账号所属 chat platform。
   */
  channel: string;
  /**
   * 账号展示名称。
   */
  name: string;
  /**
   * 平台身份展示文案。
   */
  identity?: string;
  /**
   * 平台所有者信息。
   */
  owner?: string;
  /**
   * 平台创建者信息。
   */
  creator?: string;
  /**
   * Telegram bot token。
   */
  botToken?: string;
  /**
   * Feishu/QQ app id。
   */
  appId?: string;
  /**
   * Feishu/QQ app secret。
   */
  appSecret?: string;
  /**
   * Feishu/Lark 域名。
   */
  domain?: string;
  /**
   * QQ 沙箱模式。
   */
  sandbox?: boolean;
  /**
   * 是否清空 bot token。
   */
  clearBotToken?: boolean;
  /**
   * 是否清空 app id。
   */
  clearAppId?: boolean;
  /**
   * 是否清空 app secret。
   */
  clearAppSecret?: boolean;
}

/**
 * Chat account 凭据创建输入。
 */
export interface ChatChannelAccountCreateInput {
  /**
   * 账号所属 chat platform。
   */
  channel: string;
  /**
   * 账号展示名称；未传时优先使用探测结果。
   */
  name?: string;
  /**
   * Telegram bot token。
   */
  botToken?: string;
  /**
   * Feishu/QQ app id。
   */
  appId?: string;
  /**
   * Feishu/QQ app secret。
   */
  appSecret?: string;
  /**
   * Feishu/Lark 域名。
   */
  domain?: string;
  /**
   * QQ 沙箱模式。
   */
  sandbox?: boolean;
  /**
   * 是否跳过自动探测。
   */
  probe?: boolean;
}
