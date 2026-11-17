/**
 * Session canonical 消息类型。
 *
 * Session 只维护一条由 sequence 排序的双主体消息序列；User 与 Agent 是顶层角色，
 * text、reasoning、tool、inbox、file、data、action、error 都是主体内部 Part；Interaction 归属 Tool。
 */

import type { JsonObject, JsonValue } from "../json/Json.js";
import type {
  SessionContextContent,
  SessionDataContent,
  SessionFileContent,
  SessionPowerContent,
  SessionModelUserContent,
  SessionTextContent,
} from "./SessionContent.js";
import type {
  SessionInteractionRequest,
  SessionInteractionResponse,
  SessionInteractionStatus,
} from "./SessionInteraction.js";
import type { SessionPromptActor } from "./SessionPromptActor.js";

/** 从其他 Session 导入时保留的来源身份。 */
export interface SessionMessageOrigin {
  /** 来源会话的永久 UUID；归档或主会话重建不会改变此来源。 */
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

/**
 * Session 输入携带的请求记账。
 *
 * 说明（中文）
 * - 这里只描述「谁发起了这次输入」以及本次请求独有的绑定，不是用户撰写的内容，
 *   保存于 User Message.meta 或 Inbox Part.meta，不参与模型上下文，也不在聊天界面渲染。
 * - 它是消息级只读数据：写入方是 SDK 输入接收链路，宿主与 UI 只读取。
 */
export interface SessionMessageMeta {
  /** 本条输入的发起方；归一化后必然存在。 */
  from: SessionPromptActor;
  /** 本次请求装配的 Power 描述快照；未使用 `powers` 时省略。 */
  powers?: JsonValue;
  /** Turn 完成回调绑定；仅携带 `callback` 的请求写入。 */
  callback?: JsonValue;
}

/** User 顶层 Message。 */
export interface SessionUserMessage extends SessionMessageBase {
  /** Message 主体角色固定为 user。 */
  role: "user";
  /** 用户消息的结构化 parts。 */
  parts: SessionUserMessagePart[];
  /** 本条输入的请求记账；由 SDK 写入，不参与展示与模型上下文。 */
  meta?: SessionMessageMeta;
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
  /** 工具完整终态输出，包含结构化失败；canonical 结果事实源。 */
  output?: JsonValue;
  /** 模型首次收到的固定小结果、折叠包或 lookup 页；completed/failed 必需，JSON null 合法，运行态不保存。 */
  model_output?: JsonValue;
  /** 固定视图的披露格式版本；completed/failed 必须为支持的版本，codec/写入/投影统一校验。 */
  disclosure_version?: number;
  /** 完整结果的稳定引用，与调用 ID 分离；completed/failed 必需，fork 保留来源引用，不重新生成。 */
  result_ref?: string;
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

/** 已持久化的 Power 回复内容，身份与顺序统一由 Session 分配。 */
export interface SessionAgentPowerPart extends SessionPowerContent {
  /** 由执行运行时绑定的来源 Tool Call；模型历史据此使用摘要替代大型调用参数。 */
  source_tool_call_id?: string;
  /** 当前 Message 内稳定的内容身份。 */
  part_id: string;
  /** Message 内不可变的线性顺序，从 1 开始。 */
  sequence: number;
  /** 产生内容的模型 Step；非模型追加可以省略。 */
  step_id?: string;
}

/** 运行时输入的因果来源；仅可信执行入口可以设置。 */
export interface SessionInboxSource {
  /** 产生该输入的 Tool Call；用于关联媒体或异步工具事件。 */
  tool_call_id?: string;
  /** 产生该输入的原 Turn；后台续行时与接收 Turn 可以不同。 */
  turn_id?: string;
}

/** 尚未分配 Part 身份的运行时输入；inbox_id 由来源提供以保证重试幂等。 */
export interface SessionInboxInput {
  /** 当前 Session 内稳定且唯一的事件身份；重试必须复用同一个值。 */
  inbox_id: string;
  /** 输入的语义种类，例如 shell_result、delegation_result、tool_media 或 runtime_notice。 */
  kind: string;
  /** 该输入关联的执行来源；不可用作用户授权。 */
  source?: SessionInboxSource;
  /** 可供模型使用的封闭内容集合；文件持久化后只保存附件引用。 */
  content: SessionModelUserContent[];
  /** 自动执行输入的请求记账；不作为模型输入或 UI 正文展示。 */
  meta?: SessionMessageMeta;
}

/** Agent 执行期间收到的一项运行时输入；与模型输出共享同一条 Part 时间线。 */
export interface SessionAgentInboxPart extends SessionInboxInput {
  /** Part 判别字段。 */
  type: "inbox";
  /** 当前 Message 内稳定的 Part 标识。 */
  part_id: string;
  /** 当前 Message 内不可变的线性顺序，从 1 开始。 */
  sequence: number;
  /** 非模型输入通常不属于模型 Step，此字段可以省略。 */
  step_id?: string;
  /** 该输入成功提交到 Message 的时间戳，单位为毫秒。 */
  created_at: number;
}

/** Agent Message Part。 */
export type SessionAgentMessagePart =
  | SessionAgentTextPart
  | SessionAgentReasoningPart
  | SessionAgentToolPart
  | SessionAgentFilePart
  | SessionAgentDataPart
  | SessionAgentPowerPart
  | SessionAgentActionPart
  | SessionAgentErrorPart
  | SessionAgentInboxPart;

/** Agent 顶层 Message。 */
export interface SessionAgentMessage extends SessionMessageBase {
  /** Message 主体角色固定为 agent。 */
  role: "agent";
  /** Agent Message 聚合当前仍在写入，还是已经永久收口。 */
  state: "streaming" | "done";
  /** 已由写入方冻结的连续 Part 前缀水位；零表示尚无可摘要前缀，水位内的 Part 永不可修改。 */
  stable_part_sequence: number;
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
