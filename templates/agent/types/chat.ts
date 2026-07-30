/**
 * Agent Server 与 React Web 共用的对话接口类型。
 *
 * 浏览器只消费稳定的展示数据，不直接依赖 Agent 内部 Message 类型。
 */

/** 对话消息角色。 */
export type ChatMessageRole = "user" | "assistant" | "error";

/** React 对话界面展示的一条消息。 */
export interface ChatMessage {
  /** Session 内稳定的消息标识。 */
  id: string;
  /** 消息发送方或错误类型。 */
  role: ChatMessageRole;
  /** 已归一化的纯文本内容。 */
  content: string;
  /** 消息创建时间，使用 Unix 毫秒时间戳。 */
  created_at: number;
}

/** 对话历史接口响应。 */
export interface ChatResponse {
  /** 当前 Session 中全部可见对话消息。 */
  messages: ChatMessage[];
}

/** 发送一条用户消息的请求。 */
export interface SendChatMessageRequest {
  /** 要追加到 Agent Session 的用户文本。 */
  content: string;
}

/** Agent API 的错误响应。 */
export interface ChatErrorResponse {
  /** 适合直接展示给用户的错误信息。 */
  error: string;
}
