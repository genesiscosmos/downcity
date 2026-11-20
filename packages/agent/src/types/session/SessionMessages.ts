/**
 * SessionMessages 输入与构造类型。
 *
 * 这些类型只描述 canonical Message 领域入口的参数，不包含持久化行为。
 */

import type { SessionCompletionPort } from "@/types/agent/SessionCompletion.js";
import type { JsonObject, SessionAgentContent, SessionMessageMeta, SessionUserContent, SessionUserPartContent, SessionMutation } from "@downcity/type";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";
import type { AgentSessionPromptInput, NormalizedAgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";

/** SessionMessages 构造参数。 */
export interface SessionMessagesOptions {
  /** 恢复时读取写前日志，区分执行已结束与真正中断。 */
  completions?: SessionCompletionPort;
  /** 当前 Session 标识。 */
  session_id: string;
  /** Message 快照持久化 Store。 */
  store: SessionStorage;
  /** 当前 Session 的附件持久化能力。 */
  attachment_store: SessionAttachmentStore;
  /** 已提交用户消息或 Agent 终态的活动时间，用于同步 Session 内存时间。 */
  on_activity?: (activity_at: number) => void;
  /** 持久化成功后的实时 Mutation 发布函数。 */
  publish: (mutation: SessionMutation) => void;
}

/** User Message 创建参数。 */
export interface AppendSessionUserMessageInput {
  /** 存储创建 factory 内的最后接收检查；抛错时不创建消息。 */
  assert_receivable?: () => void;
  /** 当前输入所属 Turn。 */
  turn_id: string;
  /** User 内容 Part；identity 与顺序由 SessionMessages 分配。 */
  parts: SessionUserPartContent[];
  /** 消息级请求记账；由 SDK 写入，不参与展示与模型上下文。 */
  meta?: SessionMessageMeta;
  /** 可选的稳定 Message 标识。 */
  message_id?: string;
}

/** Assistant Message 创建参数。 */
export interface OpenSessionAgentMessageInput {
  /** Writer 所属实际执行代次，用于恢复时识别子工作。 */
  execution_id?: string;
  /** 当前调用的 Writer 所有权检查，旧流不能写入恢复后的同一消息。 */
  assert_current?: () => void;
  /** 当前 Assistant 所属 Turn。 */
  turn_id: string;
  /** 可选的稳定 Message 标识。 */
  message_id?: string;
}

/** 完成 Action Part 时允许覆盖的内容。 */
export interface CompleteSessionAgentActionPartInput {
  /** 完成时覆盖的可选标题。 */
  title?: string;
  /** 完成时覆盖的可选描述。 */
  description?: string;
  /** 完成时写入的可选结构化数据。 */
  data?: JsonObject;
}

/** 将 Error Part 归入所属 Turn Agent Message 的参数。 */
export interface AppendSessionAgentErrorPartInput {
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
  /** 可选的结构化 User 内容。 */
  parts?: SessionUserContent[];
  /** 未提供结构化内容时使用的纯文本。 */
  text?: string;
}

/** 公开 Session API 追加 Assistant Message 的输入。 */
export interface AppendExternalSessionAgentMessageInput {
  /** 可选的结构化 Assistant 内容。 */
  parts?: SessionAgentContent[];
  /** 未提供结构化内容时使用的纯文本。 */
  text?: string;
}

/** Session Prompt 转换并持久化的输入。 */
export interface AppendSessionPromptMessageInput {
  /** 附件解析及存储等待结束后的最后接收检查。 */
  assert_receivable?: () => void;
  /** 当前 Agent 项目的绝对根目录，用于解析本地附件。 */
  project_root: string;
  /** 当前 Session Prompt 输入；调用对象已由接收边界归一化。 */
  prompt: NormalizedAgentSessionPromptInput;
  /** 当前输入所属 Turn。 */
  turn_id: string;
  /** 幂等 Prompt 使用的稳定 User Message ID。 */
  message_id?: string;
}

/** 原消息恢复的内存检查点；不属于持久化输入。 */
export interface SessionMessageResume {
  /** 同一原 canonical 消息。 */ message_id: string;
  /** 接收时的消息版本。 */ revision: number;
  /** 当前错误位置，拒绝旧按钮。 */ error_part_id: string;
}

/** 每次普通方法调用独占的输出 Adapter 依赖。 */
export interface SessionAssistantOutputAdapterOptions {
  /** 本次实际执行代次；同 Turn 重试创建新身份。 */
  execution_id?: string;
  /** 原逻辑 Turn 标识。 */ turn_id: string;
  /** 当前调用的对象所有权检查，旧流不能写新调用。 */ assert_current?: () => void;
  /** 恢复事务提交前确认本次 signal 未停止；不约束已接收事实的失败收口。 */ assert_resumable?: () => void;
  /** 原消息恢复检查点；只消费一次。 */ resume?: SessionMessageResume;
  /** canonical 消息唯一写入入口。 */ messages: import("@/session/messages/SessionMessages.js").SessionMessages;
}
