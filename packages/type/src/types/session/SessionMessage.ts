/**
 * Session canonical 消息类型。
 *
 * Session 只维护一条由 sequence 排序的双主体消息序列；User 与 Agent 是顶层角色，
 * text、reasoning、tool、interaction、file、data、action、error 都是主体内部 Part。
 */

import type { JsonObject, JsonValue } from "../json/Json.js";
import type {
  SessionContextContent,
  SessionDataContent,
  SessionFileContent,
  SessionTextContent,
} from "./SessionContent.js";
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
export interface SessionUserTextPart extends SessionTextContent {
  /** User Message 内稳定的 part 标识。 */
  part_id: string;
  /** Part 在当前 User Message 内的不可变线性顺序，从 1 开始。 */
  sequence: number;
}

/** User 带语义标签的模型上下文 part。 */
export interface SessionUserContextPart extends SessionContextContent {
  /** User Message 内稳定的 part 标识。 */
  part_id: string;
  /** Part 在当前 User Message 内的不可变线性顺序，从 1 开始。 */
  sequence: number;
}

/** User 文件 part。 */
export interface SessionUserFilePart extends SessionFileContent {
  /** User Message 内稳定的 part 标识。 */
  part_id: string;
  /** Part 在当前 User Message 内的不可变线性顺序，从 1 开始。 */
  sequence: number;
}

/** User 结构化数据 part。 */
export interface SessionUserDataPart extends SessionDataContent {
  /** User Message 内稳定的 part 标识。 */
  part_id: string;
  /** Part 在当前 User Message 内的不可变线性顺序，从 1 开始。 */
  sequence: number;
}

/** User Message part。 */
export type SessionUserMessagePart =
  | SessionUserTextPart
  | SessionUserContextPart
  | SessionUserFilePart
  | SessionUserDataPart;

/**
 * 尚未分配身份与顺序的 User Part。
 *
 * 调用方只能提供内容：`part_id` 在存储中是全局主键，`sequence` 是消息内的位置，
 * 两者都必须由拥有该消息的一方统一分配，否则多个 Message 会产生相同的 `part_id`。
 */
export type SessionUserPartContent =
  | Omit<SessionUserTextPart, "part_id" | "sequence">
  | Omit<SessionUserContextPart, "part_id" | "sequence">
  | Omit<SessionUserFilePart, "part_id" | "sequence">
  | Omit<SessionUserDataPart, "part_id" | "sequence">;

/** User 顶层 Message。 */
export interface SessionUserMessage extends SessionMessageBase {
  /** Message 主体角色固定为 user。 */
  role: "user";
  /** 用户消息的结构化 parts。 */
  parts: SessionUserMessagePart[];
}

/** Agent 普通文本 Part。 */
export interface SessionAgentTextPart extends SessionTextContent {
  /** Agent Message 内稳定的 Part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** 产生当前 Part 的模型 Step；非模型追加内容可以为空。 */
  step_id?: string;
  /** 文本 part 是否已经结束。 */
  state: "streaming" | "done";
}

/** Agent 推理文本 Part。 */
export interface SessionAgentReasoningPart {
  /** Agent Message 内稳定的 Part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** 产生当前 Part 的模型 Step；非模型追加内容可以为空。 */
  step_id?: string;
  /** part 类型固定为 reasoning。 */
  type: "reasoning";
  /** 当前已经累计的完整推理文本。 */
  text: string;
  /** 推理 part 是否已经结束。 */
  state: "streaming" | "done";
  /** Provider 用于后续模型上下文续接的可选不透明签名。 */
  reasoning_signature?: string;
}

/** Agent 工具 Part。 */
export interface SessionAgentToolPart {
  /** Agent Message 内稳定的 Part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** 产生当前 Part 的模型 Step；非模型追加内容可以为空。 */
  step_id?: string;
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
  /**
   * 本次 Tool 执行中向用户发起的交互，按发生顺序排列。
   *
   * 同一时刻至多一个处于 pending：Tool 在等待响应时阻塞，因此顺序由数组本身表达。
   */
  interactions?: SessionAgentInteraction[];
}

/**
 * Agent 工具执行期间向用户发起的一次交互。
 *
 * Interaction 不是独立 Part，而是所属 Tool 的一部分：Tool 在等待响应时阻塞，
 * 所以一次 Interaction 的完整生命周期严格落在所属 Tool 的执行区间内。
 */
export interface SessionAgentInteraction {
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

/** Agent 文件 Part。 */
export interface SessionAgentFilePart extends SessionFileContent {
  /** Agent Message 内稳定的 Part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** 产生当前 Part 的模型 Step；非模型追加内容可以为空。 */
  step_id?: string;
}

/** Agent 结构化数据 Part。 */
export interface SessionAgentDataPart extends SessionDataContent {
  /** Agent Message 内稳定的 Part 标识。 */
  part_id: string;
  /** Assistant Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** 产生当前 Part 的模型 Step；非模型追加内容可以为空。 */
  step_id?: string;
}

/** Agent Action Part。 */
export interface SessionAgentActionPart {
  /** Agent Message 内稳定的 Part 标识。 */
  part_id: string;
  /** Agent Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** 产生当前 Part 的模型 Step；Session Action 可以为空。 */
  step_id?: string;
  /** Part 类型固定为 action。 */
  type: "action";
  /** 同一 Action 生命周期内稳定复用的业务标识。 */
  action_id: string;
  /** Action 业务类别。 */
  action_type: string;
  /** Action 当前生命周期状态。 */
  state: "running" | "completed" | "failed";
  /** Action 展示标题。 */
  title: string;
  /** Action 展示描述。 */
  description?: string;
  /** Action 附加结构化信息。 */
  data?: JsonObject;
}

/** Agent Error Part。 */
export interface SessionAgentErrorPart {
  /** Agent Message 内稳定的 Part 标识。 */
  part_id: string;
  /** Agent Part 在当前 Message 中的不可变线性顺序，从 1 开始。 */
  sequence: number;
  /** 产生当前 Part 的模型 Step；Session/Turn 错误可以为空。 */
  step_id?: string;
  /** Part 类型固定为 error。 */
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

/** Agent Message Part。 */
export type SessionAgentMessagePart =
  | SessionAgentTextPart
  | SessionAgentReasoningPart
  | SessionAgentToolPart
  | SessionAgentFilePart
  | SessionAgentDataPart
  | SessionAgentActionPart
  | SessionAgentErrorPart;

/** Agent 顶层 Message。 */
export interface SessionAgentMessage extends SessionMessageBase {
  /** Message 主体角色固定为 agent。 */
  role: "agent";
  /** Agent Message 聚合当前仍在写入，还是已经永久收口。 */
  state: "streaming" | "done";
  /** Agent 内按真实产生顺序保存的 Parts。 */
  parts: SessionAgentMessagePart[];
}

/** Session 唯一顶层 Message 联合类型。 */
export type SessionMessage =
  | SessionUserMessage
  | SessionAgentMessage;

/** 读取 Session Message snapshot 的分页输入。 */
export interface ListSessionMessagesInput {
  /** 返回该 Message sequence 之前的一页历史；必须是正整数。 */
  before_sequence?: number;
  /** 单页返回的最大 Message 数量。 */
  limit?: number;
  /** 是否包含 internal Message。 */
  include_internal?: boolean;
}

/** Session Message snapshot 分页结果。 */
export interface SessionMessagePage {
  /** 当前页按 sequence 升序排列的完整 Message。 */
  items: SessionMessage[];
  /** 当前 Session 已分配的真实 Message 总数。 */
  total: number;
  /** 当前结果覆盖的第一条真实 Message sequence。 */
  start_sequence?: number;
  /** 当前结果覆盖的最后一条真实 Message sequence。 */
  end_sequence?: number;
  /** 继续向前读取时作为 before_sequence 传入的边界。 */
  next_before_sequence?: number;
  /** 当前结果之前是否仍有更早 Segment。 */
  has_more: boolean;
}
