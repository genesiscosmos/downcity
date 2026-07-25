/**
 * SessionMessages 输入与构造类型。
 *
 * 这些类型只描述 canonical Message 领域入口的参数，不包含持久化行为。
 */

import type { JsonObject } from "@/types/common/Json.js";
import type { SessionRecordV1 } from "@/executor/types/SessionRecords.js";
import type { SessionMessageStore } from "@/types/store/SessionStore.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type {
  SessionAssistantMessagePart,
  SessionUserMessagePart,
} from "@/types/session/SessionMessage.js";
import type { SessionMutation } from "@/types/session/SessionMutation.js";

/** SessionMessages 构造参数。 */
export interface SessionMessagesOptions {
  /** 当前 Session 标识。 */
  session_id: string;
  /** Message 快照持久化 Store。 */
  store: SessionMessageStore;
  /** 持久化成功后的实时 Mutation 发布函数。 */
  publish: (mutation: SessionMutation) => void;
}

/** User Message 创建参数。 */
export interface AppendSessionUserMessageInput {
  /** 当前输入所属 Turn。 */
  turn_id: string;
  /** 当前输入是普通 Prompt 还是 Steering 输入。 */
  input_type: "prompt" | "steer";
  /** User 结构化 Part。 */
  parts: SessionUserMessagePart[];
  /** 可选的稳定 Message 标识。 */
  message_id?: string;
  /** 当前 Message 的默认展示范围。 */
  visibility?: "visible" | "internal";
}

/** Assistant Message 创建参数。 */
export interface OpenSessionAssistantMessageInput {
  /** 当前 Assistant 所属 Turn。 */
  turn_id: string;
  /** 当前 Assistant 在 Turn 内的 Segment 序号。 */
  segment_index: number;
  /** 当前 Assistant 是普通回复还是压缩 Summary。 */
  kind?: "normal" | "summary";
  /** 当前 Message 的默认展示范围。 */
  visibility?: "visible" | "internal";
  /** 可选的稳定 Message 标识。 */
  message_id?: string;
  /** Summary 已覆盖到的来源 Message 标识。 */
  summary_through_message_id?: string;
}

/** 已完成 Assistant Message 的直接写入参数。 */
export interface AppendCompletedAssistantMessageInput {
  /** 当前 Assistant 所属 Turn。 */
  turn_id?: string;
  /** Assistant 完整结构化 Part。 */
  parts: SessionAssistantMessagePart[];
  /** 当前 Assistant 是普通回复还是压缩 Summary。 */
  kind?: "normal" | "summary";
  /** 当前 Message 的默认展示范围。 */
  visibility?: "visible" | "internal";
  /** Summary 已覆盖到的来源 Message 标识。 */
  summary_through_message_id?: string;
}

/** Action Message 创建参数。 */
export interface OpenSessionActionMessageInput {
  /** 可选的稳定 Message 标识，用于更新同一个 Action 生命周期。 */
  message_id?: string;
  /** 当前 Action 所属 Turn。 */
  turn_id?: string;
  /** 当前 Action 的业务类型。 */
  action_type: string;
  /** 当前 Action 标题。 */
  title: string;
  /** 当前 Action 描述。 */
  description?: string;
  /** 当前 Action 附加数据。 */
  data?: JsonObject;
}

/** Error Message 创建参数。 */
export interface AppendSessionErrorMessageInput {
  /** 当前错误影响 Session 还是单个 Turn。 */
  scope: "session" | "turn";
  /** 当前错误所属 Turn。 */
  turn_id?: string;
  /** 当前错误的稳定业务码。 */
  code: string;
  /** 当前错误的用户可见文本。 */
  message: string;
  /** 当前错误是否允许恢复。 */
  recoverable: boolean;
}

/** 公开 Session API 追加 User Message 的输入。 */
export interface AppendExternalSessionUserMessageInput {
  /** 可选的结构化 User Record。 */
  message?: SessionRecordV1 | null;
  /** 未提供结构化 Record 时使用的纯文本。 */
  text?: string;
}

/** 公开 Session API 追加 Assistant Message 的输入。 */
export interface AppendExternalSessionAssistantMessageInput {
  /** 可选的结构化 Assistant Record。 */
  message?: SessionRecordV1 | null;
  /** 未提供结构化 Record 时使用的纯文本。 */
  fallback_text?: string;
}

/** Session Prompt 转换并持久化的输入。 */
export interface AppendSessionPromptMessageInput {
  /** 当前 Agent 项目的绝对根目录，用于解析本地附件。 */
  project_root: string;
  /** 当前 Session Prompt 输入。 */
  prompt: AgentSessionPromptInput;
  /** 当前输入所属 Turn。 */
  turn_id: string;
  /** 当前输入是普通 Prompt 还是 Steering 输入。 */
  input_type: "prompt" | "steer";
}
