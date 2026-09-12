/** Chat Conversation、Inbox、Outbox 与 Activity 的持久化类型。 */

import type { ChatProvider } from "./ChatAccount.js";

/** Conversation 当前是否接受新的消息执行。 */
export type ChatConversationStatus = "active" | "paused";

/** 一个外部会话到 Agent Session 的稳定映射。 */
export interface ChatConversationRecord {
  /** Chat Plugin 内部稳定 Conversation ID。 */
  conversation_id: string;
  /** Conversation 所属 Bot Account。 */
  account_id: string;
  /** 平台原始会话 ID。 */
  external_chat_id: string;
  /** 平台会话类型。 */
  chat_type: string;
  /** 可选的平台 Thread/Topic ID。 */
  thread_id?: string;
  /** 最近观测到的会话标题。 */
  title?: string;
  /** 当前负责执行的 Agent。 */
  agent_id: string;
  /** 当前 Session 使用的 Workspace。 */
  workspace_id: string;
  /** 当前 Conversation 对应的 Agent Session。 */
  session_id: string;
  /** 当前 Conversation 状态。 */
  status: ChatConversationStatus;
  /** 最近收到消息的 Unix 毫秒时间。 */
  last_message_at?: number;
  /** 创建时间。 */
  created_at: number;
  /** 最近更新时间。 */
  updated_at: number;
}

/** Connector 交给 Chat Runtime 的标准化入站消息。 */
export interface ChatInboundMessage {
  /** 收到该消息的 Bot Account。 */
  account_id: string;
  /** 当前消息的平台类型。 */
  provider: ChatProvider;
  /** 平台消息稳定 ID，用于幂等去重。 */
  external_message_id: string;
  /** 平台原始会话 ID。 */
  external_chat_id: string;
  /** 平台会话类型。 */
  chat_type: string;
  /** 可选的平台 Thread/Topic ID。 */
  thread_id?: string;
  /** 外部发送者稳定 ID。 */
  sender_id: string;
  /** 外部发送者展示名称。 */
  sender_name?: string;
  /** 最近观测到的会话标题。 */
  title?: string;
  /** 标准化后的用户文本。 */
  text: string;
  /** 平台消息接收时间。 */
  received_at: number;
}

/** Inbox 消息处理状态。 */
export type ChatInboxStatus =
  | "received"
  | "pending"
  | "processing"
  | "processed"
  | "retry_wait"
  | "failed";

/** Chat Inbox 中的一条可靠入站记录。 */
export interface ChatInboxRecord {
  /** Inbox 内部稳定 ID。 */
  inbound_id: string;
  /** 收到消息的 Bot Account。 */
  account_id: string;
  /** 平台消息稳定 ID。 */
  external_message_id: string;
  /** 解析完成后的 Conversation ID。 */
  conversation_id?: string;
  /** 完整标准化消息。 */
  message: ChatInboundMessage;
  /** 当前处理状态。 */
  status: ChatInboxStatus;
  /** 已经尝试执行的次数。 */
  attempt_count: number;
  /** 最早允许再次领取的时间。 */
  available_at: number;
  /** 当前处理 lease 的过期时间。 */
  lease_expires_at?: number;
  /** 最近一次处理错误。 */
  error?: string;
  /** 创建时间。 */
  created_at: number;
  /** 最近更新时间。 */
  updated_at: number;
}

/** Outbox 支持的平台操作。 */
export type ChatDeliveryOperation = "text" | "attachment" | "reaction";

/** Outbox 投递状态。 */
export type ChatOutboxStatus =
  | "pending"
  | "sending"
  | "retry_wait"
  | "delivered"
  | "failed";

/** Chat Outbox 中的一条可靠外发记录。 */
export interface ChatOutboxRecord {
  /** Outbox 内部稳定 ID。 */
  delivery_id: string;
  /** 负责发送的 Bot Account。 */
  account_id: string;
  /** 目标 Conversation。 */
  conversation_id: string;
  /** 需要执行的平台操作。 */
  operation: ChatDeliveryOperation;
  /** 发送操作需要的 JSON 数据。 */
  payload: Record<string, unknown>;
  /** 当前投递状态。 */
  status: ChatOutboxStatus;
  /** 已经尝试投递的次数。 */
  attempt_count: number;
  /** 最早允许投递的时间。 */
  available_at: number;
  /** 当前发送 lease 的过期时间。 */
  lease_expires_at?: number;
  /** 平台返回的消息 ID。 */
  external_message_id?: string;
  /** 最近一次投递错误。 */
  error?: string;
  /** 创建时间。 */
  created_at: number;
  /** 最近更新时间。 */
  updated_at: number;
}

/** Chat Activity 事件类型。 */
export type ChatActivityType =
  | "account_started"
  | "account_stopped"
  | "account_error"
  | "account_reconnecting"
  | "account_recovered"
  | "message_received"
  | "inbound_audit"
  | "access_blocked"
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "delivery_completed"
  | "delivery_failed";

/** Desktop 可展示的一条 Chat Activity。 */
export interface ChatActivityRecord {
  /** Activity 稳定 ID。 */
  activity_id: string;
  /** 相关 Bot Account。 */
  account_id: string;
  /** 相关 Conversation。 */
  conversation_id?: string;
  /** 事件类型。 */
  type: ChatActivityType;
  /** 不包含密钥和完整消息正文的结构化详情。 */
  detail: Record<string, unknown>;
  /** 事件创建时间。 */
  created_at: number;
}
