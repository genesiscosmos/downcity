/**
 * Workspace Tool 的统一执行结果协议。
 *
 * Workspace 不依赖 Agent 的 Session 结果类型，但保留与 Agent Executor
 * 约定兼容的 `output/messages` 形状，便于 Workspace Tool 被任意 Agent 消费。
 */

import type { UIMessage } from "ai";

/** Workspace Tool 执行后附加的一条模型消息。 */
export interface WorkspaceToolActionMessage {
  /** 消息归属；Workspace 文件工具目前只产生 User 文件附件。 */
  role: "user" | "assistant";

  /** 写入会话消息的标准 UI Parts。 */
  parts: UIMessage["parts"];
}

/** Workspace Tool 执行后的统一结果。 */
export interface WorkspaceToolActionResult<TOutput = unknown> {
  /** 返回给 AI SDK 和调用方的结构化工具输出。 */
  output: TOutput;

  /** 工具执行产生的附加模型消息。 */
  messages: WorkspaceToolActionMessage[];
}
