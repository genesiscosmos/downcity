/** Renderer 对 canonical Session 消息执行批处理与渲染投影时使用的内部类型。 */

import type { SessionAgentMessage, SessionMessage } from "@downcity/type";

/** Agent 消息在单批 mutation 内部使用的可变构建状态，不会逃逸到 Renderer 快照。 */
export interface AgentMessageMutationDraft {
  /** 当前批次已经合并到的 Agent 消息。 */
  message: SessionAgentMessage;
  /** 只在当前批次首次修改消息时复制一次的 parts。 */
  parts: SessionAgentMessage["parts"];
  /** 当前 parts 按稳定 part_id 建立的批内位置索引。 */
  part_indexes: Map<string, number>;
}

/** 与一份 canonical 消息数组引用严格对应的 message_id 位置索引。 */
export interface SessionMessageIndex {
  /** 创建该索引时对应的不可变消息数组，用于拒绝复用过期索引。 */
  source_messages: SessionMessage[];
  /** 每个可见 message_id 在 source_messages 中的位置。 */
  positions_by_id: Map<string, number>;
}

/** 一批 mutation 的消息数组与持久索引投影结果。 */
export interface IndexedSessionMutationResult {
  /** 合并 mutation 后按 sequence 排列的 canonical 可见消息。 */
  messages: SessionMessage[];
  /** 与 messages 新引用严格对应、可供下一批 mutation 复用的位置索引。 */
  message_index: SessionMessageIndex;
}
