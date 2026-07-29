/**
 * Chat Channel 运行时账号快照。
 *
 * 关键点（中文）
 * - 该类型只用于 Channel Adapter 消费宿主已解析的构造参数。
 * - 它不表达存储、账号池或 Resource 查询能力。
 * - 生命周期字段用于现有状态与访问控制逻辑，不是 Plugin Resource 的持久化协议。
 */

import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";

/** 一个 Channel 启动所需的完整运行时账号快照。 */
export interface ChatRuntimeAccount {
  /** 来源 Resource 或 SDK 调用方提供的稳定 ID。 */
  id: string;

  /** 账号对应的 Chat Channel 类型。 */
  channel: ChatChannelName;

  /** 面向用户展示的名称。 */
  name: string;

  /** 可选平台身份。 */
  identity?: string;

  /** 可选平台所有者。 */
  owner?: string;

  /** 可选平台创建者。 */
  creator?: string;

  /** Telegram Bot Token。 */
  bot_token?: string;

  /** Feishu 或 QQ App ID。 */
  app_id?: string;

  /** Feishu 或 QQ App Secret。 */
  app_secret?: string;

  /** Feishu / Lark API Domain。 */
  domain?: string;

  /** QQ 是否使用 Sandbox 环境。 */
  sandbox?: boolean;

  /** 快照创建时间。 */
  created_at: string;

  /** 快照更新时间。 */
  updated_at: string;
}
