/** Desktop Chat Composer 跨进程内容投影类型。 */

import type { JsonValue } from "@downcity/agent";

/** Chat Composer 投影出的 Markdown 正文。 */
export interface ChatComposerTextPart {
  /** 内容判别字段。 */
  type: "text";
  /** 从 Tiptap 文档稳定序列化得到的 Markdown 正文。 */
  text: string;
}

/** Chat Composer 投影出的模型上下文。 */
export interface ChatComposerContextPart {
  /** 内容判别字段。 */
  type: "context";
  /** Context 进入 Session 时使用的稳定语义标签。 */
  tag: string;
  /** 进入模型上下文的原始内容。 */
  context: string;
}

/** Chat Composer 投影出的文件附件。 */
export interface ChatComposerFilePart {
  /** 内容判别字段。 */
  type: "file";
  /** 附件的 IANA MIME 类型。 */
  media_type: string;
  /** 可跨进程传输的附件 URL；新上传文件使用 Data URL。 */
  url: string;
  /** 用户可见的原始文件名。 */
  filename: string;
}

/** Chat Composer 投影出的结构化数据。 */
export interface ChatComposerDataPart {
  /** 内容判别字段。 */
  type: "data";
  /** 结构化数据的业务类型。 */
  data_type: string;
  /** 可跨进程传输的结构化值。 */
  data: JsonValue;
  /** 可选稳定数据标识。 */
  data_id?: string;
}

/** Tiptap 文档按原始内容顺序投影出的封闭内容集合。 */
export type ChatComposerPart =
  | ChatComposerTextPart
  | ChatComposerContextPart
  | ChatComposerFilePart
  | ChatComposerDataPart;

/** Composer 文档向 Session 内容投影时使用的边界约束。 */
export interface ChatComposerProjectionOptions {
  /** 除新上传 Data URL 外，允许复用的 canonical 附件地址。 */
  allowed_attachment_urls?: ReadonlySet<string>;
}
