/** Renderer 对 canonical Session 消息执行批处理与渲染投影时使用的内部类型。 */

import type { SessionMessage } from "@downcity/agent";

/** canonical Action 消息。 */
export type SessionActionMessage = Extract<SessionMessage, { type: "action" }>;

/** canonical Assistant 消息。 */
export type SessionAssistantMessage = Extract<SessionMessage, { type: "assistant" }>;

/** Assistant 消息在单批 mutation 内部使用的可变构建状态，不会逃逸到 Renderer 快照。 */
export interface AssistantMutationDraft {
  /** 当前批次已经合并到的 Assistant 消息。 */
  message: SessionAssistantMessage;
  /** 只在当前批次首次修改消息时复制一次的 parts。 */
  parts: SessionAssistantMessage["parts"];
  /** 当前 parts 按稳定 part_id 建立的批内位置索引。 */
  part_indexes: Map<string, number>;
}

/** 一条完成 Action 归属计算的 Session 消息渲染投影。 */
export interface SessionMessageRow {
  /** 当前需要渲染的 canonical 消息。 */
  message: SessionMessage;
  /** 紧邻并归属于当前 Assistant 的 canonical Action 消息。 */
  actions: SessionActionMessage[];
  /** 当前消息是否位于 canonical 消息列表末尾。 */
  is_last_message: boolean;
}

/** 一组具有稳定 sequence 区间的 Session 消息渲染行。 */
export interface SessionMessageSegment {
  /** 由 canonical sequence 区间生成的稳定分段标识。 */
  segment_id: number;
  /** 当前分段包含的有序消息渲染行。 */
  rows: SessionMessageRow[];
  /** 当前分段是否包含仍在流式更新的 Assistant 消息。 */
  has_streaming_message: boolean;
}

/** Session 消息列表的一次完整分段渲染投影。 */
export interface SessionMessageProjection {
  /** 按 canonical sequence 升序排列的稳定分段。 */
  segments: SessionMessageSegment[];
  /** 全部分段中是否存在仍在流式更新的 Assistant 消息。 */
  has_streaming_message: boolean;
  /** 当前消息是否包含可参与上下文压缩的 User 或 Assistant 消息。 */
  has_conversation_message: boolean;
}
