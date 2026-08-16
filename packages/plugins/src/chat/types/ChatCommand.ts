/**
 * Chat 命令协议类型。
 *
 * 关键点（中文）
 * - chat 模块自有请求/响应类型放在 chat/types
 * - 避免所有业务类型集中堆到全局 types/
 */

export type ChatSessionSnapshot = {
  session_id?: string;
  chat_key?: string;
  channel?: string;
  chatId?: string;
  messageThreadId?: number;
  chatType?: string;
  user_id?: string;
  message_id?: string;
};

export type ChatSendRequest = {
  text: string;
  chat_key?: string;
  delay_ms?: number;
  send_at_ms?: number;
  reply_to_message?: boolean;
  message_id?: string;
};

export type ChatSendResponse = {
  success: boolean;
  chat_key?: string;
  error?: string;
};

export type ChatReactRequest = {
  chat_key?: string;
  message_id?: string;
  emoji?: string;
  big?: boolean;
};

export type ChatReactResponse = {
  success: boolean;
  chat_key?: string;
  message_id?: string;
  error?: string;
};

export type ChatDeleteRequest = {
  chat_key?: string;
  session_id?: string;
};

export type ChatDeleteResponse = {
  success: boolean;
  session_id?: string;
  deleted?: boolean;
  removedMeta?: boolean;
  removedChatDir?: boolean;
  removedSessionDir?: boolean;
  error?: string;
};

export type ChatHistoryDirection = "all" | "inbound" | "outbound";

export type ChatHistoryRequest = {
  chat_key?: string;
  session_id?: string;
  limit?: number;
  direction?: ChatHistoryDirection;
  beforeTs?: number;
  afterTs?: number;
};

/**
 * Chat 会话列表请求。
 *
 * 关键点（中文）
 * - 仅列出当前 AgentWorkspace 已记录的 chat context（来自其数据目录的 `channel/meta.json`）。
 * - 不会向外部平台拉取“全部会话”，因为平台侧通常需要额外权限且成本高。
 */
export type ChatListRequest = {
  /**
   * 渠道过滤（telegram/feishu/qq）。
   *
   * 说明（中文）
   * - 不传则返回全部渠道。
   */
  channel?: string;
  /**
   * 返回条数上限。
   *
   * 说明（中文）
   * - 不传则使用默认值（由服务端决定）。
   */
  limit?: number;
  /**
   * 关键词查询。
   *
   * 说明（中文）
   * - 会在 `session_id/chatId/chatTitle/actorName/actorId` 中做包含匹配（不区分大小写）。
   */
  q?: string;
};

/**
 * Chat 会话列表条目（用于展示）。
 */
export type ChatListItemV1 = {
  /**
   * 可发送的 chat_key。
   *
   * 关键点（中文）
   * - 当前实现下 `chat_key === session_id`。
   */
  chat_key: string;
  /**
   * 对外稳定的 session_id。
   *
   * 说明（中文）
   * - 当前内部以 session 语义统一建模。
   */
  session_id: string;
  /**
   * 渠道类型（telegram/feishu/qq）。
   */
  channel: string;
  /**
   * 平台 chat 原始 ID。
   */
  chatId: string;
  /**
   * 平台 chat 类型（group/c2c/channel/p2p...）。
   */
  targetType?: string;
  /**
   * 平台 thread/topic ID（仅部分渠道存在）。
   */
  threadId?: number;
  /**
   * 会话展示名（群名/频道名/私聊对象名）。
   */
  chatTitle?: string;
  /**
   * 最近触发该会话的用户名/昵称（best-effort）。
   */
  actorName?: string;
  /**
   * 最近触发该会话的用户 ID（best-effort）。
   */
  actorId?: string;
  /**
   * 最近更新的毫秒时间戳。
   */
  updated_at: number;
  /**
   * `updated_at` 的 ISO 时间字符串（UTC）。
   */
  isoUpdatedAt: string;
};

/**
 * Chat 会话信息请求（查看单个会话的元信息与本地路径）。
 */
export type ChatInfoRequest = {
  /**
   * 目标 chat_key（不传则尝试读取 DC_CTX_CHAT_KEY / 当前请求上下文）。
   */
  chat_key?: string;
  /**
   * 显式 session_id（优先级高于 chat_key）。
   */
  session_id?: string;
};
