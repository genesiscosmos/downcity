/**
 * Feishu 渠道共享类型。
 *
 * 关键点（中文）
 * - 集中声明 Feishu 渠道的配置、事件、消息体与上传下载中间结构。
 * - `plugins/chat/channels/feishu/*` 统一依赖这里，避免实现文件内联大量局部类型。
 */

/**
 * 飞书适配器配置。
 */
export interface FeishuConfig {
  /**
   * 飞书应用 AppId。
   */
  appId: string;
  /**
   * 飞书应用 AppSecret。
   */
  appSecret: string;
  /**
   * 是否启用飞书渠道。
   */
  enabled: boolean;
  /**
   * 可选的飞书 Open API 域名。
   */
  domain?: string;
}

/**
 * 飞书消息事件。
 */
export interface FeishuMessageEvent {
  /**
   * 发送者信息。
   */
  sender?: {
    /**
     * 发送者 ID 集合。
     */
    sender_id?: {
      /**
       * 用户 user_id。
       */
      user_id?: string;
      /**
       * 用户 open_id。
       */
      open_id?: string;
      /**
       * 用户 union_id。
       */
      union_id?: string;
      /**
       * 兼容 chat_id 字段。
       */
      chat_id?: string;
    };
  };
  /**
   * 消息主体。
   */
  message?: {
    /**
     * 会话 chat_id。
     */
    chat_id: string;
    /**
     * 原始内容 JSON。
     */
    content: string;
    /**
     * 消息类型。
     */
    message_type: string;
    /**
     * 会话类型。
     */
    chat_type: string;
    /**
     * 消息 ID。
     */
    message_id: string;
    /**
     * 根消息 ID。
     */
    root_id?: string;
    /**
     * 父消息 ID。
     */
    parent_id?: string;
  };
}

/**
 * 飞书消息发送类型。
 */
export type FeishuMessagePayloadType = "text" | "file" | "image" | "post";

/**
 * 飞书发送者归一化结果。
 */
export interface FeishuSenderIdentity {
  /**
   * 归一化后的发送者 ID。
   */
  senderId?: string;
  /**
   * 发送者 ID 的类型。
   */
  idType?: "open_id" | "user_id" | "union_id";
}

/**
 * 飞书下载后的本地附件结构。
 */
export interface FeishuDownloadedAttachment {
  /**
   * 统一附件类型。
   */
  type: "document" | "photo" | "voice" | "audio" | "video";
  /**
   * 本地绝对路径。
   */
  path: string;
  /**
   * 可选说明文本。
   */
  desc?: string;
}
