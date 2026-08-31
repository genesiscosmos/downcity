/**
 * Downcity Session UI 消息协议模块。
 *
 * 该协议服务持久化与界面时间线，不作为模型或 Provider 调用协议。
 */

/** Session UI 消息中的通用内容 part。 */
export interface SessionUiPart {
  /** Part 判别字段。 */
  type: string;
  /** 文本或推理内容。 */
  text?: string;
  /** 文件 MIME 类型。 */
  mediaType?: string;
  /** 文件 URL、本地路径或 Data URL。 */
  url?: string;
  /** 可选文件名。 */
  filename?: string;
  /** 工具调用 ID。 */
  toolCallId?: string;
  /** 工具生命周期状态。 */
  state?: string;
  /** 工具输入。 */
  input?: unknown;
  /** 工具输出。 */
  output?: unknown;
  /** 工具错误文本。 */
  errorText?: string;
  /** 其它 UI 扩展字段。 */
  [key: string]: unknown;
}

/** Downcity Session UI 消息。 */
export interface SessionUiMessage<TMetadata = unknown> {
  /** 消息稳定 ID。 */
  id: string;
  /** Session 消息角色。 */
  role: "user" | "assistant" | "system";
  /** 可选 Session metadata。 */
  metadata?: TMetadata;
  /** 有序 UI 内容。 */
  parts: SessionUiPart[];
}

/** Session assistant 增量事件。 */
export interface SessionUiMessageChunk {
  /** 增量事件判别字段。 */
  type: string;
  /** 其它与事件类型对应的字段。 */
  [key: string]: any;
}

/** 判断是否为文本 UI part。 */
export function is_session_text_part(part: unknown): part is SessionUiPart & { type: "text"; text: string } {
  return Boolean(part && typeof part === "object" && (part as SessionUiPart).type === "text" && typeof (part as SessionUiPart).text === "string");
}

/** 判断是否为文件 UI part。 */
export function is_session_file_part(part: unknown): part is SessionUiPart & { type: "file"; url: string } {
  return Boolean(part && typeof part === "object" && (part as SessionUiPart).type === "file" && typeof (part as SessionUiPart).url === "string");
}

/** 判断是否为工具 UI part。 */
export function is_session_tool_part(part: unknown): part is SessionUiPart {
  return Boolean(part && typeof part === "object" && typeof (part as SessionUiPart).type === "string" && (part as SessionUiPart).type.startsWith("tool-"));
}

/** 从工具 UI part 读取工具名称。 */
export function read_session_tool_name(part: SessionUiPart): string {
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : "";
}
