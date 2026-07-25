/**
 * contact chat 类型。
 *
 * 关键点（中文）
 * - 一个 contact 固定一条长期 chat history。
 * - 用户不需要主动维护 session id。
 */

/**
 * contact chat 远端消息请求。
 */
export interface ContactRemoteChatRequest {
  /**
   * 发送方 contact id。
   */
  senderContactId: string;
  /**
   * 消息正文。
   */
  message: string;
  /**
   * 消息创建时间戳。
   */
  created_at: number;
}

/**
 * contact chat 响应。
 */
export interface ContactChatResponse {
  /**
   * chat 是否成功。
   */
  success: boolean;
  /**
   * 对方回复文本。
   */
  reply: string;
  /**
   * 本地 contact id。
   */
  contactId: string;
  /**
   * 失败原因。
   */
  error?: string;
}
