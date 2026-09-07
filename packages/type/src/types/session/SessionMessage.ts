/**
 * Session canonical 消息类型。
 *
 * Session 只维护一条由 sequence 排序的消息序列；assistant 的 text、reasoning、tool、file
 * 均为内部 part，不提升为顶层消息。
 */

import type { JsonObject, JsonValue } from "../json/Json.js";
import type {
  SessionInteractionRequest,
  SessionInteractionResponse,
  SessionInteractionStatus,
} from "./SessionInteraction.js";

/** Message 默认展示范围。 */
export type SessionMessageVisibility = "visible" | "internal";

/** 从其他 Session 导入时保留的来源身份。 */
export interface SessionMessageOrigin {
  /** 来源 Session 标识。 */
  session_id: string;
  /** 来源 Message 标识。 */
  message_id: string;
  /** 来源 turn 标识。 */
  turn_id?: string;
}

/** Session Message 公共字段。 */
export interface SessionMessageBase {
  /** 当前 Message 在 Session 内的稳定唯一标识。 */
  message_id: string;
  /** 当前 Message 所属 Session 标识。 */
  session_id: string;
  /** 当前 Message 所属 turn；独立 action 可以省略。 */
  turn_id?: string;
  /** Message 的线性位置；创建后永远不变。 */
  sequence: number;
  /** Message 版本号；每次对外发布的消息变化后递增。 */
  revision: number;
  /** 当前 Message 是否默认对用户可见。 */
  visibility: SessionMessageVisibility;
  /** Message 首次创建时间戳（ms）。 */
  created_at: number;
  /** Message 最近更新时间戳（ms）。 */
  updated_at: number;
  /** 从其他 Session 导入时的来源信息。 */
  origin?: SessionMessageOrigin;
}

/** User 文本 part。 */
export interface SessionUserTextPart {
  /** User Message 内稳定的 part 标识。 */
  part_id: string;
  /** part 类型固定为 text。 */
  type: "text";
  /** 用户输入文本。 */
  text: string;
  /** User 文本已经完整，不参与流式更新。 */
  state: "done";
}

/** User 带语义标签的模型上下文 part。 */
export interface SessionUserContextPart {
  /** User Message 内稳定的 part 标识。 */
  part_id: string;
  /** part 类型固定为 context。 */
  type: "context";
  /** 模型上下文使用的安全 XML 风格标签名。 */
  tag: string;
  /** 进入模型上下文时由标签包裹的原始内容。 */
  context: string;
}

/** User 文件 part。 */
export interface SessionUserFilePart {
  /** User Message 内稳定的 part 标识。 */
  part_id: string;
  /** part 类型固定为 file。 */
  type: "file";
  /** 文件可读取地址或 data URL。 */
  url: string;
  /** 文件 MIME 类型。 */
  media_type: string;
  /** 可选原始文件名。 */
  filename?: string;
}

/** User 结构化数据 part。 */
export interface SessionUserDataPart {
  /** User Message 内稳定的 part 标识。 */
  part_id: string;
  /** part 类型固定为 data。 */
  type: "data";
  /** Session data part 的类型名称。 */
  data_type: `data-${string}` | string;
  /** 可 JSON 序列化的数据。 */
  data: JsonValue;
  /** Session data part 的可选稳定标识。 */
  data_id?: string;
}

/** User Message part。 */
export type SessionUserMessagePart =
  | SessionUserTextPart
  | SessionUserContextPart
  | SessionUserFilePart
  | SessionUserDataPart;

/** User 顶层 Message。 */
export interface SessionUserMessage extends SessionMessageBase {
  /** Message 类型固定为 user。 */
  type: "user";
  /** 普通 prompt 或当前 turn 中的 steering 输入。 */
  input_type: "prompt" | "steer";
  /** 用户消息的结构化 parts。 */
  parts: SessionUserMessagePart[];
}

/** Assistant 普通文本 part。 */
export interface SessionAssistantTextPart {
  /** Assistant Message 内稳定的 part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** part 类型固定为 text。 */
  type: "text";
  /** 当前已经累计的完整文本。 */
  text: string;
  /** 文本 part 是否已经结束。 */
  state: "streaming" | "done";
}

/** Assistant 推理文本 part。 */
export interface SessionAssistantReasoningPart {
  /** Assistant Message 内稳定的 part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** part 类型固定为 reasoning。 */
  type: "reasoning";
  /** 当前已经累计的完整推理文本。 */
  text: string;
  /** 推理 part 是否已经结束。 */
  state: "streaming" | "done";
  /** Provider 用于后续模型上下文续接的可选不透明签名。 */
  reasoning_signature?: string;
}

/** Assistant 工具 part。 */
export interface SessionAssistantToolPart {
  /** Assistant Message 内稳定的 part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** part 类型固定为 tool。 */
  type: "tool";
  /** 模型工具调用稳定标识。 */
  tool_call_id: string;
  /** 工具注册名称。 */
  tool_name: string;
  /** 工具当前生命周期状态。 */
  state: "input-streaming" | "ready" | "waiting-user" | "running" | "completed" | "failed";
  /** 流式接收中的参数原文。 */
  input_text?: string;
  /** 收敛后的结构化输入。 */
  input?: JsonValue;
  /** 工具成功输出。 */
  output?: JsonValue;
  /** 工具失败信息。 */
  error?: string;
  /** 工具调用的可选展示标题。 */
  title?: string;
}

/** Assistant 用户异步交互 part。 */
export interface SessionAssistantInteractionPart {
  /** Assistant Message 内稳定的 part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** part 类型固定为 interaction。 */
  type: "interaction";
  /** 当前 Interaction 的稳定唯一标识。 */
  interaction_id: string;
  /** 当前 Interaction 的具体业务类型。 */
  interaction_type: string;
  /** 当前 Interaction 的生命周期状态。 */
  status: SessionInteractionStatus;
  /** 已持久化的完整 Interaction 请求。 */
  request: SessionInteractionRequest;
  /** 用户已响应时保存的结构化响应。 */
  response?: SessionInteractionResponse;
  /** Interaction 进入终态的时间戳，单位为毫秒。 */
  resolved_at?: number;
  /** Interaction 被取消时保存的稳定原因。 */
  cancel_reason?: "turn_stopped" | "session_disposed" | "runtime_interrupted";
}

/** Assistant 文件 part。 */
export interface SessionAssistantFilePart {
  /** Assistant Message 内稳定的 part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** part 类型固定为 file。 */
  type: "file";
  /** 文件 MIME 类型。 */
  media_type: string;
  /** 文件可读取地址或 data URL。 */
  url: string;
  /** 可选原始文件名。 */
  filename?: string;
}

/** Assistant 结构化数据 part。 */
export interface SessionAssistantDataPart {
  /** Assistant Message 内稳定的 part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** part 类型固定为 data。 */
  type: "data";
  /** Session data part 的类型名称。 */
  data_type: `data-${string}` | string;
  /** 可 JSON 序列化的数据。 */
  data: JsonValue;
  /** Session data part 的可选稳定标识。 */
  data_id?: string;
}

/** Assistant Message part。 */
export type SessionAssistantMessagePart =
  | SessionAssistantTextPart
  | SessionAssistantReasoningPart
  | SessionAssistantToolPart
  | SessionAssistantInteractionPart
  | SessionAssistantFilePart
  | SessionAssistantDataPart;

/** Assistant 顶层 Message。 */
export interface SessionAssistantMessage extends SessionMessageBase {
  /** Message 类型固定为 assistant。 */
  type: "assistant";
  /** 普通 Assistant 回复或内部 compact summary。 */
  kind: "normal" | "summary";
  /** Assistant 当前执行状态。 */
  status: "streaming" | "completed" | "stopped" | "failed";
  /** Assistant 内按真实生成顺序保存的 parts。 */
  parts: SessionAssistantMessagePart[];
  /** Summary 已覆盖到的来源 Message 标识。 */
  summary_through_message_id?: string;
}

/** Action 顶层 Message。 */
export interface SessionActionMessage extends SessionMessageBase {
  /** Message 类型固定为 action。 */
  type: "action";
  /** Action 业务类型。 */
  action_type: string;
  /** Action 当前状态。 */
  status: "running" | "completed" | "failed";
  /** Action 展示标题。 */
  title: string;
  /** Action 展示描述。 */
  description?: string;
  /** Action 附加结构化信息。 */
  data?: JsonObject;
}

/** Error 顶层 Message。 */
export interface SessionErrorMessage extends SessionMessageBase {
  /** Message 类型固定为 error。 */
  type: "error";
  /** 错误影响范围。 */
  scope: "session" | "turn";
  /** 稳定错误码。 */
  code: string;
  /** 用户可见错误信息。 */
  message: string;
  /** 当前错误是否允许重试恢复。 */
  recoverable: boolean;
}

/** Session 唯一顶层 Message 联合类型。 */
export type SessionMessage =
  | SessionUserMessage
  | SessionAssistantMessage
  | SessionActionMessage
  | SessionErrorMessage;

/** 读取 Session Message snapshot 的分页输入。 */
export interface ListSessionMessagesInput {
  /**
   * 返回该 sequence 之前的最近一个完整历史 Segment。
   *
   * 必须是正整数；省略时直接返回 Active 中的全部 Message。
   */
  before_sequence?: number;
  /** 是否包含 internal Message。 */
  include_internal?: boolean;
}

/** Session Message snapshot 分页结果。 */
export interface SessionMessagePage {
  /** 当前 Active 或 Segment 中按 sequence 升序排列的 Message。 */
  items: SessionMessage[];
  /** 当前 Session 已分配的真实 Message 总数。 */
  total: number;
  /** 当前结果来自 Active 还是已关闭 Segment。 */
  source: "active" | "segment";
  /** 当前结果覆盖的第一条真实 Message sequence。 */
  start_sequence?: number;
  /** 当前结果覆盖的最后一条真实 Message sequence。 */
  end_sequence?: number;
  /** 继续向前读取时应作为 before_sequence 传入的边界。 */
  next_before_sequence?: number;
  /** 当前结果之前是否仍有更早 Segment。 */
  has_more: boolean;
}
