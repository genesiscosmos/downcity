/**
 * Downcity 模型消息内容协议模块。
 *
 * 内容使用封闭的判别联合，Provider Adapter 只能消费明确受支持的模型语义。
 */

import type { ModelJsonValue } from "./ModelJson.js";

/** 模型消息允许携带的内容。 */
export type ModelContent =
  | ModelTextContent
  | ModelFileContent
  | ModelReasoningContent
  | ModelToolCallContent
  | ModelToolResultContent;

/** 模型文本内容。 */
export interface ModelTextContent {
  /** 内容判别字段。 */
  type: "text";
  /** 非空文本内容。 */
  text: string;
}

/** 模型文件内容。 */
export interface ModelFileContent {
  /** 内容判别字段。 */
  type: "file";
  /** 文件的 IANA MIME 类型。 */
  media_type: string;
  /** 文件内容的唯一来源。 */
  source: ModelFileSource;
  /** 可选原始文件名。 */
  filename?: string;
}

/** 模型文件允许使用的来源。 */
export type ModelFileSource = ModelFileUrlSource | ModelFileBase64Source;

/** 通过网络 URL 引用的文件来源。 */
export interface ModelFileUrlSource {
  /** URL 来源判别字段。 */
  type: "url";
  /** 可由 Provider 读取的绝对 HTTP 或 HTTPS URL。 */
  url: string;
}

/** 通过 Base64 内联的文件来源。 */
export interface ModelFileBase64Source {
  /** Base64 来源判别字段。 */
  type: "base64";
  /** 不包含 Data URL 前缀的 Base64 内容。 */
  data: string;
}

/** 模型推理内容。 */
export interface ModelReasoningContent {
  /** 内容判别字段。 */
  type: "reasoning";
  /** Provider 允许返回给调用方的推理文本。 */
  text: string;
  /** Provider 用于后续上下文续接的可选不透明签名。 */
  signature?: string;
}

/** assistant 发起的工具调用。 */
export interface ModelToolCallContent {
  /** 内容判别字段。 */
  type: "tool_call";
  /** 单次模型上下文内稳定且唯一的工具调用 ID。 */
  tool_call_id: string;
  /** 工具名称。 */
  tool_name: string;
  /** 已完成 JSON 解析的工具输入。 */
  input: ModelJsonValue;
}

/** 工具执行后返回给模型的结果。 */
export interface ModelToolResultContent {
  /** 内容判别字段。 */
  type: "tool_result";
  /** 对应工具调用 ID。 */
  tool_call_id: string;
  /** 对应工具名称。 */
  tool_name: string;
  /** 工具执行结果。 */
  outcome: "succeeded" | "failed";
  /** 返回给模型的有序结果内容。 */
  content: ModelToolResultPart[];
}

/** 工具结果允许携带的内容。 */
export type ModelToolResultPart =
  | ModelTextContent
  | ModelFileContent
  | ModelJsonContent;

/** 工具返回的结构化 JSON 内容。 */
export interface ModelJsonContent {
  /** 内容判别字段。 */
  type: "json";
  /** 可跨进程传输的结构化值。 */
  value: ModelJsonValue;
}
