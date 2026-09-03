/**
 * Session 入站与 Action 内容类型。
 *
 * 这些类型只描述尚未分配 Session identity 的内容。进入 Session 后，
 * `SessionMessages` 会为每个 part 分配稳定标识并转换成 canonical `SessionMessage`。
 */

import type { JsonValue } from "@/types/common/Json.js";

/** Session 输入中的文本内容。 */
export interface SessionTextInputPart {
  /** 内容判别字段。 */
  type: "text";
  /** 用户或 Action 产生的完整文本。 */
  text: string;
}

/** Session 输入中带语义标签的模型上下文。 */
export interface SessionContextInputPart {
  /** 内容判别字段。 */
  type: "context";
  /** 模型上下文使用的安全 XML 风格标签名。 */
  tag: string;
  /** 进入模型上下文时由标签包裹的原始内容。 */
  context: string;
}

/** Session 输入中的文件内容。 */
export interface SessionFileInputPart {
  /** 内容判别字段。 */
  type: "file";
  /** 文件的 IANA MIME 类型。 */
  media_type: string;
  /** 文件的远程 URL、本地路径或 Data URL。 */
  url: string;
  /** 可选原始文件名。 */
  filename?: string;
}

/** Session 输入中的结构化数据内容。 */
export interface SessionDataInputPart {
  /** 内容判别字段。 */
  type: "data";
  /** 结构化数据的业务类型。 */
  data_type: string;
  /** 可跨进程传输的结构化值。 */
  data: JsonValue;
  /** 可选稳定数据标识。 */
  data_id?: string;
}

/** `session.prompt()` 接受的封闭内容集合。 */
export type SessionPromptPart =
  | SessionTextInputPart
  | SessionContextInputPart
  | SessionFileInputPart
  | SessionDataInputPart;

/** Action 可以追加到 Assistant Message 的封闭内容集合。 */
export type SessionAssistantResultPart =
  | SessionTextInputPart
  | SessionFileInputPart
  | SessionDataInputPart;
