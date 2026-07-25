/**
 * ChatPromptContext：chat prompt 注入相关类型。
 *
 * 关键点（中文）
 * - 统一描述“当前 chat 环境”与“入站用户信息”两类 prompt 数据。
 * - chat 路由环境与用户身份信息分离，避免把平台路由字段混入 user info。
 * - 所有字段均保持可序列化，便于 system prompt 与入站消息文本复用。
 */

import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";

/**
 * 当前 chat 环境提示输入。
 */
export interface ChatEnvironmentPromptInput {
  /**
   * 当前会话对应的 session_id。
   *
   * 说明（中文）
   * - 对外统一使用 `session_id` 语义。
   * - chat plugin runtime 内部统一按 session 语义路由与持久化。
   */
  session_id: string;

  /**
   * 当前 chat_key。
   *
   * 说明（中文）
   * - chat plugin runtime 里通常与 `session_id` 一致。
   * - 保留独立字段，避免未来路由键语义调整时影响调用方。
   */
  chat_key: string;

  /**
   * 当前消息来源渠道。
   *
   * 说明（中文）
   * - 例如 `telegram`、`feishu`、`qq`。
   */
  channel: ChatDispatchChannel;

  /**
   * 平台原始 chatId。
   *
   * 说明（中文）
   * - 该值仅用于路由，不应被模型当作用户身份字段理解。
   */
  chatId: string;

  /**
   * 平台侧会话类型。
   *
   * 说明（中文）
   * - 例如 `private`、`group`、`channel`、`topic`、`c2c`。
   */
  chatType?: string;

  /**
   * 平台 thread/topic 标识。
   *
   * 说明（中文）
   * - 仅在支持 topic/thread 的平台中提供。
   */
  threadId?: number;

  /**
   * 当前会话展示名。
   *
   * 说明（中文）
   * - 例如群名、频道名、私聊对象名。
   * - 仅用于帮助模型理解上下文，不参与路由匹配。
   */
  chatTitle?: string;
}

/**
 * 入站用户信息提示输入。
 */
export interface QueuedUserInfoInput {
  /**
   * 当前消息 ID。
   *
   * 说明（中文）
   * - 这是本次入站事件对应的平台消息标识。
   * - 保留在 user/request info 中，便于 reply/react 等操作定位本轮输入。
   */
  message_id?: string;

  /**
   * 当前发言用户 ID。
   *
   * 说明（中文）
   * - 来自平台侧用户标识，可能为空或不可得。
   */
  user_id?: string;

  /**
   * 当前发言用户名或昵称。
   *
   * 说明（中文）
   * - 渠道适配器按 best-effort 提供。
   */
  username?: string;

  /**
   * 当前消息接收时间。
   *
   * 说明（中文）
   * - 推荐传入 ISO8601 字符串。
   * - 为空时由构造器回退到当前系统时间。
   */
  receivedAt?: string;

  /**
   * 当前用户时区。
   *
   * 说明（中文）
   * - 仅在上游网关或客户端显式提供时传入。
   * - Telegram / Feishu / QQ 等 bot 入站通常不会直接提供该字段。
   */
  userTimezone?: string;
}
