/**
 * ChatPlugin action 类型定义。
 *
 * 关键点（中文）
 * - 这里集中声明 chat plugin runtime action 的输入 payload。
 * - 这些类型属于跨模块共享契约，因此统一放到 `types/` 下。
 * - 字段命名保持与 CLI/API 参数一致，降低映射心智负担。
 */

import type {
  ChatDeleteRequest,
  ChatHistoryRequest,
  ChatInfoRequest,
  ChatListRequest,
  ChatReactRequest,
} from "@/chat/types/ChatCommand.js";
import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";

/**
 * `chat.send` action 的输入载荷。
 */
export type ChatSendActionPayload = {
  /**
   * 要发送的正文文本。
   */
  text: string;
  /**
   * 目标 chat_key；未显式传入时可由执行上下文补全。
   */
  chat_key?: string;
  /**
   * 延迟发送毫秒数；与 `send_at_ms` 互斥。
   */
  delay_ms?: number;
  /**
   * 绝对发送时间戳（毫秒）；与 `delay_ms` 互斥。
   */
  send_at_ms?: number;
  /**
   * 是否使用 reply_to_message 语义回复目标消息。
   */
  reply_to_message?: boolean;
  /**
   * 显式指定目标消息 ID；通常用于 reply/react 等场景。
   */
  message_id?: string;
};

/**
 * 读取会话上下文类 action 的输入载荷。
 */
export type ChatSessionActionPayload = {
  /**
   * 目标 chat_key；与 session_id 二选一即可。
   */
  chat_key?: string;
  /**
   * 目标 session_id；优先级高于 chat_key。
   */
  session_id?: string;
};

/**
 * `chat.history` action 的输入载荷。
 */
export type ChatHistoryActionPayload = ChatHistoryRequest;

/**
 * `chat.history_clear` action 的输入载荷。
 */
export interface ChatHistoryClearActionPayload {
  /** 要清空 Chat 事件历史的 Session 标识。 */
  session_id: string;
}

/**
 * `chat.react` action 的输入载荷。
 */
export type ChatReactActionPayload = ChatReactRequest;

/**
 * `chat.delete` action 的输入载荷。
 */
export type ChatDeleteActionPayload = ChatDeleteRequest;

/**
 * `chat.list` action 的输入载荷。
 */
export type ChatListActionPayload = ChatListRequest;

/**
 * `chat.info` action 的输入载荷。
 */
export type ChatInfoActionPayload = ChatInfoRequest;

/**
 * `chat.status` action 的输入载荷。
 */
export type ChatStatusActionPayload = {
  /**
   * 指定目标渠道；省略时表示全部渠道。
   */
  channel?: ChatChannelName;
};

/**
 * `chat.test` action 的输入载荷。
 */
export type ChatTestActionPayload = {
  /**
   * 指定目标渠道；省略时表示全部渠道。
   */
  channel?: ChatChannelName;
};

/**
 * `chat.reconnect` action 的输入载荷。
 */
export type ChatReconnectActionPayload = {
  /**
   * 指定目标渠道；省略时表示全部渠道。
   */
  channel?: ChatChannelName;
};
