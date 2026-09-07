/** Desktop Chat 输入编排持久化边界类型。 */

import type { JSONContent } from "@tiptap/core";
import type { QueuedChatMessage } from "@/types/DesktopView";

/** IndexedDB 中保存的一份 Chat 输入草稿记录。 */
export interface PersistedChatDraft {
  /** 记录结构版本，用于恢复时拒绝不兼容的数据。 */
  schema_version: number;
  /** Agent Session 或 Group Session 的无歧义组合键。 */
  session_key: string;
  /** 可完整恢复文本、引用和 Base64 附件的 Tiptap JSON 文档。 */
  draft: JSONContent;
  /** 最近一次写入记录的 Unix 毫秒时间戳。 */
  updated_at: number;
}

/** IndexedDB 中保存的一份待发送消息队列记录。 */
export interface PersistedChatQueue {
  /** 记录结构版本，用于恢复时拒绝不兼容的数据。 */
  schema_version: number;
  /** 队列所属 Agent Session 的无歧义组合键。 */
  session_key: string;
  /** 按用户指定顺序保存的完整待发送消息。 */
  queued_messages: QueuedChatMessage[];
  /** 最近一次写入记录的 Unix 毫秒时间戳。 */
  updated_at: number;
}

/** composer store 启动时可恢复的持久化快照。 */
export interface ChatComposerPersistenceSnapshot {
  /** 按 Session 组合键隔离的有效输入草稿。 */
  draft_content_by_session: Record<string, JSONContent>;
  /** 按 Session 组合键隔离的有效待发送消息队列。 */
  queued_messages_by_session: Record<string, QueuedChatMessage[]>;
  /** 按恢复出的非空队列标记的会话级暂停状态，避免启动后自动发送。 */
  queue_paused_by_session: Record<string, boolean>;
}

/** Chat 输入编排持久化能力。 */
export interface ChatComposerStorage {
  /** 加载全部有效草稿和队列。 */
  load(): Promise<ChatComposerPersistenceSnapshot>;
  /** 保存或覆盖指定 Session 的非空草稿。 */
  save_draft(session_key: string, draft: JSONContent): Promise<void>;
  /** 删除指定 Session 的草稿。 */
  remove_draft(session_key: string): Promise<void>;
  /** 将草稿从旧 Session 组合键迁移到新组合键。 */
  move_draft(source_key: string, target_key: string): Promise<void>;
  /** 保存或覆盖指定 Session 的非空待发送队列。 */
  save_queue(session_key: string, queued_messages: QueuedChatMessage[]): Promise<void>;
  /** 删除指定 Session 的待发送队列。 */
  remove_queue(session_key: string): Promise<void>;
  /** 删除组合键匹配任一前缀的草稿和队列。 */
  remove_prefixes(prefixes: readonly string[]): Promise<void>;
}
