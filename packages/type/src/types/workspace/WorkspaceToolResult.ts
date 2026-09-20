/**
 * Workspace Tool 的统一执行结果协议。
 *
 * Workspace 不依赖 Agent 的 Session 结果类型，但保留与 Agent Executor
 * 约定兼容的 `output/messages` 形状，便于 Workspace Tool 被任意 Agent 消费。
 */

import type { ToolEffect } from "@downcity/type";

/** Workspace Tool 产生的文本消息内容。 */
export interface WorkspaceToolTextPart {
  /** 内容判别字段。 */
  type: "text";
  /** 文本内容。 */
  text: string;
}

/** Workspace Tool 产生的文件消息内容。 */
export interface WorkspaceToolFilePart {
  /** 内容判别字段。 */
  type: "file";
  /** 本地文件路径、远程 URL 或 data URL。 */
  url: string;
  /** 文件的 IANA MIME 类型。 */
  media_type: string;
  /** 可选原始文件名。 */
  filename?: string;
}

/** Workspace Tool 可以追加到 Session 的消息内容。 */
export type WorkspaceToolMessagePart = WorkspaceToolTextPart | WorkspaceToolFilePart;

/** Workspace Tool 执行后附加的一条模型消息。 */
export interface WorkspaceToolActionMessage {
  /** 消息归属；Workspace 文件工具目前只产生 User 文件附件。 */
  role: "user" | "assistant";

  /** 写入会话消息的 Downcity Workspace Parts。 */
  parts: WorkspaceToolMessagePart[];
}

/** Workspace Tool 执行后的统一结果。 */
export interface WorkspaceToolActionResult<TOutput = unknown> {
  /** 返回给 Agent 和调用方的结构化工具输出。 */
  output: TOutput;

  /** 工具执行产生的附加模型消息。 */
  messages: WorkspaceToolActionMessage[];

  /** 已经发生且需要由当前 Turn 收集的副作用；不会作为 Tool output 发送给模型。 */
  effects?: readonly ToolEffect[];
}
