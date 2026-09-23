/**
 * Feishu 附件指令类型定义。
 *
 * 关键点（中文）
 * - 当前用于解析回复文本中的 `<file ...>` 标签。
 * - 解析结果由 Feishu channel 在出站阶段转换为平台文件消息。
 */

/**
 * 附件类型。
 *
 * 说明（中文）
 * - 与 Telegram 的附件类型保持同一语义集合，便于跨渠道复用相同指令。
 */
export type FeishuAttachmentType =
  | "document"
  | "photo"
  | "voice"
  | "audio"
  | "video";

/**
 * 一条 `<file>` 标签解析后的结构。
 */
export interface ParsedFeishuAttachmentCommand {
  /**
   * 附件类型。
   *
   * 说明（中文）
   * - 由 `<file type="...">` 的 `type` 属性解析得到。
   */
  type: FeishuAttachmentType;

  /**
   * 附件路径或 URL 原文。
   *
   * 说明（中文）
   * - 当前飞书实现优先支持项目内本地路径（相对路径或绝对路径）。
   */
  pathOrUrl: string;

  /**
   * 可选附件说明文字。
   *
   * 说明（中文）
   * - 来源于 `|` 后面的可选文本。
   * - channel 可选择作为补充文本单独发送。
   */
  caption?: string;
}
