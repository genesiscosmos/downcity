/**
 * Chat 消息标记语法类型。
 *
 * 关键点（中文）
 * - 统一描述 chat plugin runtime 中可见的消息协议：frontmatter metadata + `<file>` 标签。
 * - direct 模式、`downcity chat send`、入站附件注入、渠道出站解析都应复用本类型。
 */

/**
 * `<file>` 标签支持的附件类型。
 *
 * 说明（中文）
 * - 语义集合与 Telegram/Feishu 当前支持的附件能力保持一致。
 * - 默认类型为 `document`。
 */
export type ChatMessageFileType =
  | "document"
  | "photo"
  | "voice"
  | "audio"
  | "video";

/**
 * 一条 `<file>` 标签解析后的结构。
 */
export interface ChatMessageFileTag {
  /**
   * 附件路径。
   *
   * 说明（中文）
   * - 当前主要使用项目内相对路径。
   * - 渠道可自行决定是否支持绝对路径或远程 URL。
   */
  path: string;

  /**
   * 附件类型。
   *
   * 说明（中文）
   * - 缺省时按 `document` 处理。
   */
  type: ChatMessageFileType;

  /**
   * 可选附件说明。
   *
   * 说明（中文）
   * - 存在时由渠道决定如何发送给最终用户。
   */
  caption?: string;
}

/**
 * 一段有序文本片段。
 */
export interface ChatMessageTextSegment {
  /**
   * 片段类型。
   */
  kind: "text";

  /**
   * 片段文本。
   *
   * 说明（中文）
   * - 已做 trim，保证不会出现纯空白文本段。
   */
  text: string;
}

/**
 * 一段有序附件片段。
 */
export interface ChatMessageFileSegment {
  /**
   * 片段类型。
   */
  kind: "file";

  /**
   * 附件内容。
   */
  file: ChatMessageFileTag;
}

/**
 * 按消息真实顺序排列的片段。
 */
export type ChatMessageSegment =
  | ChatMessageTextSegment
  | ChatMessageFileSegment;

/**
 * 一段 chat 消息正文解析后的结果。
 */
export interface ParsedChatMessageMarkup {
  /**
   * frontmatter metadata 原始对象。
   *
   * 说明（中文）
   * - 只在正文最顶部存在合法 YAML frontmatter 时才会填充。
   * - 解析失败时会退化为 `{}`，避免误删正文。
   */
  metadata: Record<string, unknown>;

  /**
   * 去掉 frontmatter 与 `<file>` 标签后的纯正文。
   *
   * 说明（中文）
   * - 会把多段文本按消息原始顺序合并，中间使用空行分隔。
   */
  body_text: string;

  /**
   * 按出现顺序提取出的附件标签列表。
   */
  files: ChatMessageFileTag[];

  /**
   * 按消息实际顺序提取出的有序片段。
   */
  segments: ChatMessageSegment[];
}

/**
 * 由 frontmatter metadata 解析出的发送参数。
 */
export interface ChatMessageSendOptions {
  /**
   * 目标 chat_key。
   *
   * 说明（中文）
   * - 未提供时由调用方回退到当前上下文或显式参数。
   */
  chat_key?: string;

  /**
   * 延迟发送毫秒数。
   *
   * 说明（中文）
   * - 由 `delay/delay_ms/delay-ms` 解析得到。
   */
  delay_ms?: number;

  /**
   * 定时发送的绝对毫秒时间戳。
   *
   * 说明（中文）
   * - 由 `time/sendAt/send_at_ms` 等字段解析得到。
   */
  send_at_ms?: number;

  /**
   * 是否使用 reply 语义发送。
   *
   * 说明（中文）
   * - 允许仅设置布尔值，也允许结合 `message_id` 一起使用。
   */
  reply_to_message?: boolean;

  /**
   * 可选目标消息 ID。
   *
   * 说明（中文）
   * - 当前主要用于 Telegram/Feishu reply 场景。
   */
  message_id?: string;
}
