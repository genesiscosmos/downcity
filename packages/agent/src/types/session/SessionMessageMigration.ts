/**
 * Session Message 持久化协议迁移类型。
 *
 * 这些类型只描述上一版四类顶层 Message，供存储初始化阶段执行一次性迁移；
 * 它们不属于公开 Session API，也不能在运行时写入新记录。
 */

import type {
  SessionAgentMessage,
  SessionMessage,
  SessionMessageBase,
} from "@downcity/type";
import type { JsonObject } from "@downcity/type";
import type { FileSystem } from "@downcity/type";

/** 上一版 Assistant 顶层 Message。 */
export interface LegacySessionAssistantMessage extends Omit<SessionAgentMessage, "type"> {
  /** 旧判别值固定为 assistant。 */
  type: "assistant";
}

/** 上一版 Action 顶层 Message。 */
export interface LegacySessionActionMessage extends SessionMessageBase {
  /** 旧判别值固定为 action。 */
  type: "action";
  /** Action 业务类别。 */
  action_type: string;
  /** Action 迁移前的生命周期状态。 */
  status: "running" | "completed" | "failed";
  /** Action 展示标题。 */
  title: string;
  /** Action 展示描述。 */
  description?: string;
  /** Action 附加结构化信息。 */
  data?: JsonObject;
}

/** 上一版 Error 顶层 Message。 */
export interface LegacySessionErrorMessage extends SessionMessageBase {
  /** 旧判别值固定为 error。 */
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

/** 迁移阶段允许读取的新旧顶层 Message。 */
export type MigratableSessionMessage =
  | SessionMessage
  | LegacySessionAssistantMessage
  | LegacySessionActionMessage
  | LegacySessionErrorMessage;

/** 一次 Session Message 存储迁移需要的物理边界。 */
export interface SessionMessageStorageMigrationInput {
  /** 当前 Session 私有且受根目录约束的文件能力。 */
  files: FileSystem;
  /** 当前 Session 的 Active JSONL 绝对路径。 */
  active_file_path: string;
  /** 当前 Session 的新 Agent 草稿绝对路径。 */
  agent_message_file_path: string;
}
