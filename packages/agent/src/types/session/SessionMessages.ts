/**
 * SessionMessages 输入与构造类型。
 *
 * 这些类型只描述 canonical Message 领域入口的参数，不包含持久化行为。
 */

import type { JsonObject } from "@downcity/type";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type {
  SessionAgentContent,
  SessionUserContent,
} from "@downcity/type";
import type { SessionUserPartContent } from "@downcity/type";
import type { SessionMutation } from "@downcity/type";

/** SessionMessages 构造参数。 */
export interface SessionMessagesOptions {
  /** 当前 Session 标识。 */
  session_id: string;
  /** Message 快照持久化 Store。 */
  store: SessionStorage;
  /** 当前 Session 的附件持久化能力。 */
  attachment_store: SessionAttachmentStore;
  /** 持久化成功后的实时 Mutation 发布函数。 */
  publish: (mutation: SessionMutation) => void;
}

/** User Message 创建参数。 */
export interface AppendSessionUserMessageInput {
  /** 当前输入所属 Turn。 */
  turn_id: string;
  /** User 内容 Part；identity 与顺序由 SessionMessages 分配。 */
  parts: SessionUserPartContent[];
  /** 可选的稳定 Message 标识。 */
  message_id?: string;
  /** 当前 Message 的默认展示范围。 */
  visibility?: "visible" | "internal";
}

/** Assistant Message 创建参数。 */
export interface OpenSessionAgentMessageInput {
  /** 当前 Assistant 所属 Turn。 */
  turn_id: string;
  /** 当前 Message 的默认展示范围。 */
  visibility?: "visible" | "internal";
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
  /** 当前 Agent 项目的绝对根目录，用于解析本地附件。 */
  project_root: string;
  /** 当前 Session Prompt 输入。 */
  prompt: AgentSessionPromptInput;
  /** 当前输入所属 Turn。 */
  turn_id: string;
  /** 幂等 Prompt 使用的稳定 User Message ID。 */
  message_id?: string;
}
