/**
 * QQ 语音/附件处理相关类型。
 *
 * 关键点（中文）
 * - 统一描述 QQ 入站附件的“原始形态”与“归一化形态”。
 * - 仅覆盖 chat 语音转写链路所需字段，避免过度耦合平台全量 schema。
 */

/**
 * QQ 网关消息中的原始附件对象（宽松字段集合）。
 *
 * 说明（中文）
 * - QQ 不同事件类型/权限集返回字段存在差异，本类型使用“可选 + 宽松”的兼容策略。
 * - 未列出的字段可通过索引签名继续透传，供调试与后续扩展。
 */
export interface QqRawInboundAttachment {
  /**
   * 附件唯一标识（可能是 `id`、`file_id`、`media_id` 等）。
   */
  id?: string;
  /**
   * 文件标识（平台侧文件 ID）。
   */
  file_id?: string;
  /**
   * 附件文件名（如 `voice.ogg`）。
   */
  filename?: string;
  /**
   * 备用文件名字段（部分 payload 使用下划线命名）。
   */
  file_name?: string;
  /**
   * MIME 类型（如 `audio/ogg`）。
   */
  content_type?: string;
  /**
   * 备用 MIME 字段（如 `mime_type`）。
   */
  mime_type?: string;
  /**
   * 下载地址（标准 URL 字段）。
   */
  url?: string;
  /**
   * 备用下载地址字段。
   */
  download_url?: string;
  /**
   * 文件地址字段（部分 payload 使用）。
   */
  file_url?: string;
  /**
   * 音频地址字段（部分 payload 使用）。
   */
  audio_url?: string;
  /**
   * 语音地址字段（部分 payload 使用）。
   */
  voice_url?: string;
  /**
   * 媒体类型（如 `audio` / `image` / `video`）。
   */
  media_type?: string;
  /**
   * 附件类型（宽松字符串，可能与 `media_type` 重复）。
   */
  type?: string;
  /**
   * 附件大小（字节）。
   */
  size?: number;
  /**
   * 允许透传未知字段，避免在 schema 演进时丢信息。
   */
  [key: string]: unknown;
}

/**
 * QQ 附件归一化后的类型枚举。
 */
export type QqInboundAttachmentKind =
  | "voice"
  | "audio"
  | "photo"
  | "video"
  | "document"
  | "unknown";

/**
 * QQ 入站附件归一化结构。
 *
 * 说明（中文）
 * - `raw` 保留平台原始对象，便于日志与排障。
 * - `localPath` 在附件已落地时可直接用于转写。
 */
export interface QqIncomingAttachment {
  /**
   * 归一化后的附件类型。
   */
  kind: QqInboundAttachmentKind;
  /**
   * 原始附件对象。
   */
  raw: QqRawInboundAttachment;
  /**
   * 附件 ID（若可解析）。
   */
  attachmentId?: string;
  /**
   * 附件文件名（若可解析）。
   */
  fileName?: string;
  /**
   * MIME 类型（若可解析）。
   */
  contentType?: string;
  /**
   * 可下载 URL（若可解析）。
   */
  url?: string;
  /**
   * 附件本地绝对路径（若已存在）。
   */
  localPath?: string;
}
