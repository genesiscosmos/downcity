/**
 * Session 历史只读投影：文件使用短生命周期 SQLite 只读连接，内存复用已有存储。
 * 复用 canonical 消息解码与分页语义，不初始化 Session、不迁移 schema、不恢复执行。
 */
import { DatabaseSync } from "node:sqlite";
import type { SessionMessage } from "@downcity/type";
import type { SessionHistoryMeta } from "@/types/store/SessionHistoryMeta.js";
import type { SessionReadView } from "@/types/store/SessionReadView.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import { read_session_metadata_from_database } from "./Browse.js";
import { decode_session_message, type SessionMessageRow, type SessionMessagePartRow } from "./SessionStorageCodec.js";

/** 从已有存储能力构造只读视图，内存模式不创建第二个数据库。 */
export function create_session_read_view(
  metadata: SessionHistoryMeta,
  archived: boolean,
  source: Pick<SessionStorage, "list_message_page" | "message_count" | "list_messages">,
): SessionReadView {
  return {
    metadata: structuredClone(metadata),
    archived,
    messages: async (input) => {
      const before_sequence = input?.before_sequence;
      if (before_sequence !== undefined && (!Number.isInteger(before_sequence) || before_sequence <= 0)) {
        throw new Error("before_sequence must be a positive integer");
      }
      const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
      const page = await source.list_message_page({ ...input, limit: limit + 1 });
      const has_more = page.length > limit;
      const items = has_more ? page.slice(1) : page;
      const start_sequence = items[0]?.sequence;
      const end_sequence = items.at(-1)?.sequence;
      return {
        items: structuredClone(items), total: await source.message_count(), has_more,
        ...(start_sequence !== undefined ? { start_sequence } : {}),
        ...(end_sequence !== undefined ? { end_sequence } : {}),
        ...(has_more && start_sequence !== undefined ? { next_before_sequence: start_sequence } : {}),
      };
    },
    interactions: async () => (await source.list_messages()).flatMap((message) => message.role === "agent"
      ? message.parts.flatMap((part) => part.type === "tool"
        ? (part.interactions ?? []).filter((entry) => entry.status === "pending").map((entry) => structuredClone(entry.request))
        : []) : []),
  };
}

/** 文件历史只打开已存在且身份匹配的数据库，每次读取结束立即关闭连接。 */
export function read_file_session_history(
  database_path: string,
  agent_id: string,
  session_id: string,
  category: string,
  archived: boolean,
): SessionReadView {
  const metadata = read_session_metadata_from_database(database_path, category);
  if (!metadata || metadata.agent_id !== agent_id || metadata.session_id !== session_id) {
    throw new Error("session_target_forbidden: Session is unavailable to this Agent");
  }
  const with_database = <T>(read: (database: DatabaseSync) => T): T => {
    const database = new DatabaseSync(database_path, { readOnly: true });
    try {
      const identity = database.prepare("SELECT agent_id, session_id FROM session_state WHERE singleton_id = 1").get();
      if (identity?.agent_id !== agent_id || identity.session_id !== session_id) {
        throw new Error("session_target_forbidden: Session identity changed");
      }
      return read(database);
    } finally { database.close(); }
  };
  return create_session_read_view(metadata, archived, {
    list_message_page: async (input) => with_database((database) => {
      const rows = database.prepare(`
        SELECT * FROM messages WHERE (? = 1 OR visibility = 'visible')
          AND (? IS NULL OR sequence < ?) ORDER BY sequence DESC LIMIT ?
      `).all(input?.include_internal === true ? 1 : 0, input?.before_sequence ?? null,
        input?.before_sequence ?? null, Math.min(Math.max(input?.limit ?? 50, 1), 201)) as unknown as SessionMessageRow[];
      return read_aggregates(database, session_id, rows.reverse());
    }),
    message_count: async () => with_database((database) => Number(
      database.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count ?? 0,
    )),
    list_messages: async () => with_database((database) => read_aggregates(database, session_id,
      database.prepare("SELECT * FROM messages ORDER BY sequence ASC").all() as unknown as SessionMessageRow[])),
  });
}

/** 按消息逐条读取 Parts，避免全历史交互查询触及 SQLite 绑定参数数量上限。 */
function read_aggregates(database: DatabaseSync, session_id: string, rows: readonly SessionMessageRow[]): SessionMessage[] {
  const parts = database.prepare("SELECT * FROM message_parts WHERE message_id = ? ORDER BY sequence ASC");
  return rows.map((row) => decode_session_message(row,
    parts.all(row.message_id) as unknown as SessionMessagePartRow[], session_id));
}
