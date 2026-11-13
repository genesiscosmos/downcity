/**
 * Agent 单库中的 Session 范围 canonical Message 引擎。
 *
 * 每条 SQL 都绑定 session_key；写入、稳定水位、计数、短预览与幂等确认在同一事务
 * 完成。消息页只加载当前页 Parts；无目录扫描、无第二份摘要库。此同步引擎只在
 * Worker 或内存库唯一拥有者线程运行，不给 Electron main 暴露同步数据库工作。
 */
import type { DatabaseSync } from "node:sqlite";
import type { SessionMessage } from "@downcity/type";
import type { AgentSessionRecord } from "@/types/store/AgentSessionDatabase.js";
import type {
  AgentSessionAppendMessage, AgentSessionMessageCommit, AgentSessionMessagePage,
  AgentSessionMessagePageInput, AgentSessionTruncateMessages, AgentSessionUpdateMessage,
} from "@/types/store/AgentSessionMessages.js";
import { decode_session_message, encode_session_message_row, encode_session_part_row,
  type SessionMessageRow, type SessionMessagePartRow } from "../SessionStorageCodec.js";
import { resolve_session_message_preview } from "../SessionMessagePreview.js";
import { AgentSessionDatabase } from "./AgentSessionDatabase.js";
import { AgentSessionCatalog } from "./AgentSessionCatalog.js";
import { validate_agent_db_message, validate_agent_db_update } from "./AgentSessionMessageValidation.js";

/** 单个引擎复用 Agent 数据库，不自行打开 Session 连接。 */
export class AgentSessionMessages {
  private readonly catalog: AgentSessionCatalog;
  constructor(private readonly owner: AgentSessionDatabase) {
    this.catalog = new AgentSessionCatalog(owner);
  }

  /** Worker 在事务内分配最终 sequence；提交确认只保存 ID、序号和 revision。 */
  append(input: AgentSessionAppendMessage): AgentSessionMessageCommit {
    return this.owner.write(input.operation_id, { command: "append", ...input }, (database) => {
      const record = this.writable_record(input.storage_id);
      const sequence = Number(database.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM messages WHERE session_key = ?")
        .get(record.session_key)?.sequence);
      const message = { ...input.message, sequence };
      if (message.revision !== 1) throw new Error("session_new_message_revision_invalid");
      if (message.origin) {
        const source = this.catalog.by_storage_id(message.origin.storage_id);
        if (source.session_id !== message.origin.session_id) throw new Error("session_fork_origin_identity_conflict");
      }
      validate_agent_db_message(message, record.session_id);
      const row = encode_session_message_row(message);
      database.prepare(`INSERT INTO messages(session_key, message_id, turn_id, sequence, revision, role, state,
        stable_part_sequence, meta, origin_storage_id, origin_session_id, origin_message_id, origin_turn_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`)
        .run(record.session_key, row.message_id, row.turn_id, row.sequence, row.revision, row.role, row.state,
          row.meta, row.origin_storage_id ?? null, row.origin_session_id, row.origin_message_id, row.origin_turn_id, row.created_at, row.updated_at);
      for (const part of message.parts) this.insert_part(database, record.session_key, message, part);
      if (row.stable_part_sequence) database.prepare("UPDATE messages SET stable_part_sequence = ? WHERE session_key = ? AND message_id = ?")
        .run(row.stable_part_sequence, record.session_key, row.message_id);
      this.update_projection(database, record, message, 1);
      return { message_id: message.message_id, sequence, revision: message.revision };
    });
  }

  /** 增量提交；所有变化 Part 成功后才推进水位及 envelope。 */
  update(input: AgentSessionUpdateMessage): AgentSessionMessageCommit {
    return this.owner.write(input.operation_id, { command: "update", ...input }, (database) => {
      const record = this.writable_record(input.storage_id);
      const current = this.message_unsafe(database, record, input.message.message_id);
      if (!current) throw new Error("session_message_not_found");
      validate_agent_db_message(input.message, record.session_id);
      validate_agent_db_update(current, input);
      const watermark = current.role === "agent" ? current.stable_part_sequence : 0;
      for (const part of input.changed_parts) {
        if (part.sequence <= watermark) continue;
        const row = encode_session_part_row(input.message, part);
        const result = database.prepare(`INSERT INTO message_parts(session_key, part_id, message_id, sequence, step_id, type, content, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_key, part_id) DO UPDATE SET step_id = excluded.step_id, type = excluded.type,
            content = excluded.content, updated_at = excluded.updated_at
          WHERE message_parts.message_id = excluded.message_id AND message_parts.sequence = excluded.sequence`)
          .run(record.session_key, row.part_id, row.message_id, row.sequence, row.step_id, row.type, row.content, row.created_at, row.updated_at);
        if (result.changes !== 1) throw new Error("session_part_identity_conflict");
      }
      const row = encode_session_message_row(input.message);
      const result = database.prepare(`UPDATE messages SET turn_id = ?, revision = ?, state = ?, stable_part_sequence = ?, meta = ?, updated_at = ?
        WHERE session_key = ? AND message_id = ? AND revision = ?`)
        .run(row.turn_id, row.revision, row.state, row.stable_part_sequence, row.meta, row.updated_at,
          record.session_key, row.message_id, input.expected_revision);
      if (result.changes !== 1) throw new Error("session_message_revision_conflict");
      this.update_projection(database, record, input.message, 0, current);
      return { message_id: row.message_id, sequence: row.sequence, revision: row.revision };
    });
  }

  /** 当前页 envelope、Parts 与总数在同一短读事务中取得。 */
  page(storage_id: string, input: AgentSessionMessagePageInput = {}): AgentSessionMessagePage {
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 201) throw new Error("session_message_page_limit_invalid");
    if (input.before_sequence !== undefined && (!Number.isSafeInteger(input.before_sequence) || input.before_sequence <= 0)) {
      throw new Error("session_message_page_sequence_invalid");
    }
    return this.owner.read((database) => {
      const record = this.catalog.by_storage_id(storage_id);
      const rows = input.before_sequence === undefined
        ? database.prepare("SELECT * FROM messages WHERE session_key = ? ORDER BY sequence DESC LIMIT ?").all(record.session_key, limit)
        : database.prepare("SELECT * FROM messages WHERE session_key = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?")
          .all(record.session_key, input.before_sequence, limit);
      return { items: this.aggregates(database, record, (rows as unknown as SessionMessageRow[]).reverse()), total: record.message_count };
    });
  }

  /** 精确读取单条消息，不因其他 Session 使用相同 message_id 而串读。 */
  message(storage_id: string, message_id: string): SessionMessage | null {
    return this.owner.read((database) => this.message_unsafe(database, this.catalog.by_storage_id(storage_id), message_id));
  }

  /** 按稳定 Part ID 找到所属 Message；fork 保留的结果引用仍限定本 Session。 */
  part_message(storage_id: string, part_id: string): SessionMessage | null {
    return this.owner.read((database) => {
      const record = this.catalog.by_storage_id(storage_id);
      const row = database.prepare(`SELECT messages.* FROM messages JOIN message_parts USING(session_key, message_id)
        WHERE messages.session_key = ? AND message_parts.part_id = ?`).get(record.session_key, part_id);
      return row ? this.aggregates(database, record, [row as unknown as SessionMessageRow])[0] : null;
    });
  }

  /** Inbox 幂等来源属于 Session 范围，不采用跨记录全局唯一。 */
  inbox_message(storage_id: string, inbox_id: string): SessionMessage | null {
    return this.owner.read((database) => {
      const record = this.catalog.by_storage_id(storage_id);
      const row = database.prepare(`SELECT messages.* FROM messages JOIN message_parts USING(session_key, message_id)
        WHERE messages.session_key = ? AND message_parts.type = 'inbox'
          AND json_extract(message_parts.content, '$.inbox_id') = ?`).get(record.session_key, inbox_id);
      return row ? this.aggregates(database, record, [row as unknown as SessionMessageRow])[0] : null;
    });
  }

  /** 截断级联清理 Composer 引用，与目录派生值同事务更新。 */
  truncate(input: AgentSessionTruncateMessages): { message_count: number } {
    if (!Number.isSafeInteger(input.through_sequence) || input.through_sequence < 0) throw new Error("session_truncate_sequence_invalid");
    return this.owner.write(input.operation_id, { command: "truncate", ...input }, (database) => {
      const record = this.writable_record(input.storage_id);
      database.prepare("DELETE FROM messages WHERE session_key = ? AND sequence > ?").run(record.session_key, input.through_sequence);
      const latest = database.prepare("SELECT * FROM messages WHERE session_key = ? ORDER BY sequence DESC LIMIT 1").get(record.session_key);
      const message = latest ? this.aggregates(database, record, [latest as unknown as SessionMessageRow])[0] : null;
      const message_count = Number(database.prepare("SELECT COUNT(*) AS n FROM messages WHERE session_key = ?").get(record.session_key)?.n ?? 0);
      database.prepare(`UPDATE sessions SET message_count = ?, preview_text = ?, revision = revision + 1 WHERE session_key = ?`)
        .run(message_count, message ? this.preview(message) : null, record.session_key);
      return { message_count };
    });
  }

  /** 附件授权查询只检查 User/Inbox canonical 文件内容。 */
  has_attachment(storage_id: string, file_path: string): boolean {
    return this.owner.read((database) => {
      const record = this.catalog.by_storage_id(storage_id);
      return Boolean(database.prepare(`SELECT 1 FROM message_parts JOIN messages USING(session_key, message_id)
        WHERE messages.session_key = ? AND (
          (messages.role = 'user' AND message_parts.type = 'file' AND json_extract(message_parts.content, '$.url') = ?)
          OR (message_parts.type = 'inbox' AND EXISTS (SELECT 1 FROM json_each(message_parts.content, '$.content') AS item
            WHERE json_extract(item.value, '$.type') = 'file' AND json_extract(item.value, '$.url') = ?))) LIMIT 1`)
        .get(record.session_key, file_path, file_path));
    });
  }

  /** 执行恢复只查该 Session 的非终态 envelope，随后加载匹配 Parts。 */
  recoverable(storage_id: string): SessionMessage[] {
    return this.owner.read((database) => {
      const record = this.catalog.by_storage_id(storage_id);
      const rows = database.prepare("SELECT * FROM messages WHERE session_key = ? AND role = 'agent' AND state = 'streaming' ORDER BY sequence")
        .all(record.session_key) as unknown as SessionMessageRow[];
      return this.aggregates(database, record, rows);
    });
  }

  /** 标题/结果恢复只加载定向 envelope 和所属 Parts，不扫描全部历史。 */
  first_user(storage_id: string): SessionMessage | null {
    return this.owner.read(database => {
      const record = this.catalog.by_storage_id(storage_id);
      const row = database.prepare("SELECT * FROM messages WHERE session_key = ? AND role = 'user' ORDER BY sequence LIMIT 1").get(record.session_key);
      return row ? this.aggregates(database, record, [row as unknown as SessionMessageRow])[0] : null;
    });
  }

  /** 精确定位最近 Agent Message，可选 Turn 过滤由复合索引支持。 */
  latest_agent(storage_id: string, turn_id?: string): SessionMessage | null {
    return this.owner.read(database => {
      const record = this.catalog.by_storage_id(storage_id);
      const row = turn_id === undefined
        ? database.prepare("SELECT * FROM messages WHERE session_key = ? AND role = 'agent' ORDER BY sequence DESC LIMIT 1").get(record.session_key)
        : database.prepare("SELECT * FROM messages WHERE session_key = ? AND role = 'agent' AND turn_id = ? ORDER BY sequence DESC LIMIT 1").get(record.session_key, turn_id);
      return row ? this.aggregates(database, record, [row as unknown as SessionMessageRow])[0] : null;
    });
  }

  /** 写路径从不修改归档；调用方先按活动地址获得稳定 storage_id。 */
  private writable_record(storage_id: string): AgentSessionRecord {
    const record = this.catalog.by_storage_id(storage_id);
    if (record.archived) throw new Error("session_archived");
    return record;
  }

  private message_unsafe(database: DatabaseSync, record: AgentSessionRecord, message_id: string): SessionMessage | null {
    const row = database.prepare("SELECT * FROM messages WHERE session_key = ? AND message_id = ?").get(record.session_key, message_id);
    return row ? this.aggregates(database, record, [row as unknown as SessionMessageRow])[0] : null;
  }

  /** Parts 只聚合本页 ID，绑定参数最多 202 个，不随全历史增长。 */
  private aggregates(database: DatabaseSync, record: AgentSessionRecord, rows: readonly SessionMessageRow[]): SessionMessage[] {
    if (!rows.length) return [];
    // 恢复可能包含超过一页的 streaming Message；分块保持绑定参数有界。
    const parts = new Map<string, SessionMessagePartRow[]>();
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = rows.slice(offset, offset + 200);
      const part_rows = database.prepare(`SELECT * FROM message_parts WHERE session_key = ?
        AND message_id IN (${batch.map(() => "?").join(",")}) ORDER BY message_id, sequence`)
        .all(record.session_key, ...batch.map(row => row.message_id)) as unknown as SessionMessagePartRow[];
      for (const part of part_rows) {
        const group = parts.get(part.message_id) ?? [];
        group.push(part); parts.set(part.message_id, group);
      }
    }
    return rows.map(row => decode_session_message(row, parts.get(row.message_id) ?? [], record.session_id));
  }

  private insert_part(database: DatabaseSync, session_key: number, message: SessionMessage, part: SessionMessage["parts"][number]): void {
    const row = encode_session_part_row(message, part);
    database.prepare(`INSERT INTO message_parts(session_key, part_id, message_id, sequence, step_id, type, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(session_key, row.part_id, row.message_id, row.sequence, row.step_id, row.type, row.content, row.created_at, row.updated_at);
  }

  /** 每次提交维护 revision/预览；仅用户消息创建或 Agent 首次进入终态推进会话时间。 */
  private update_projection(database: DatabaseSync, record: AgentSessionRecord, message: SessionMessage, increment: number, previous?: SessionMessage): void {
    const activity_at = message.role === "user" ? message.created_at
      : message.state !== "streaming" && (!previous || previous.role === "agent" && previous.state === "streaming")
        ? message.updated_at : record.updated_at;
    database.prepare(`UPDATE sessions SET message_count = message_count + ?,
      preview_text = CASE WHEN (SELECT MAX(sequence) FROM messages WHERE session_key = ?) = ? THEN ? ELSE preview_text END,
      updated_at = MAX(updated_at, ?), revision = revision + 1 WHERE session_key = ?`)
      .run(increment, record.session_key, message.sequence, this.preview(message), activity_at, record.session_key);
  }

  private preview(message: SessionMessage): string | null {
    return Array.from(resolve_session_message_preview(message).trim()).slice(0, 180).join("") || null;
  }
}
