/**
 * Session Message 的无身份内容协议。
 *
 * Content 只表达调用方希望写入的内容；Session 持久化时为其增加 Part identity，
 * 不再为 Prompt、Action 或运行期输入复制多套同构 Part 类型。
 */

import type { JsonValue } from "../json/Json.js";

/** Session 文本内容。 */
export interface SessionTextContent {
  /** 内容判别字段。 */
  type: "text";
  /** 完整文本。 */
  text: string;
}

/** Session 带语义标签的模型上下文内容。 */
export interface SessionContextContent {
  /** 内容判别字段。 */
  type: "context";
  /** 模型上下文使用的安全 XML 风格标签名。 */
  tag: string;
  /** 进入模型上下文时由标签包裹的原始内容。 */
  context: string;
}

/** Session 文件内容。 */
export interface SessionFileContent {
  /** 内容判别字段。 */
  type: "file";
  /** 文件的 IANA MIME 类型。 */
  media_type: string;
  /** 文件的远程 URL、本地路径或 Data URL。 */
  url: string;
  /** 可选原始文件名。 */
  filename?: string;
}

/** Session 结构化数据内容。 */
export interface SessionDataContent {
  /** 内容判别字段。 */
  type: "data";
  /** 结构化数据的业务类型。 */
  data_type: string;
  /** 可跨进程传输的结构化值。 */
  data: JsonValue;
  /** 可选稳定数据标识。 */
  data_id?: string;
}

/** 可以进入模型 User Message 的 Session 内容。 */
export type SessionModelUserContent =
  | SessionTextContent
  | SessionContextContent
  | SessionFileContent;

/** `session.prompt()` 可以写入 User Message 的封闭内容集合。 */
export type SessionUserContent =
  | SessionModelUserContent
  | SessionDataContent;

/** Action 可以追加到 Agent Message 的封闭内容集合。 */
export type SessionAgentContent =
  | SessionTextContent
  | SessionFileContent
  | SessionDataContent;
