/** Desktop Chat Composer 跨进程内容投影类型。 */

/** Chat Composer 投影出的 Markdown 正文。 */
export interface ChatComposerTextPart {
  /** 内容判别字段。 */
  type: "text";
  /** 从 Tiptap 文档稳定序列化得到的 Markdown 正文。 */
  text: string;
}

/** Chat Composer 投影出的消息引用上下文。 */
export interface ChatComposerContextPart {
  /** 内容判别字段。 */
  type: "context";
  /** 引用进入 Session Context 时使用的稳定语义标签。 */
  tag: "reference";
  /** 被引用消息的原始正文。 */
  context: string;
}

/** Chat Composer 投影出的文件附件。 */
export interface ChatComposerFilePart {
  /** 内容判别字段。 */
  type: "file";
  /** 附件的 IANA MIME 类型。 */
  media_type: string;
  /** 可跨进程传输的附件 Data URL。 */
  url: string;
  /** 用户可见的原始文件名。 */
  filename: string;
}

/** Tiptap 文档按原始内容顺序投影出的封闭内容集合。 */
export type ChatComposerPart =
  | ChatComposerTextPart
  | ChatComposerContextPart
  | ChatComposerFilePart;
