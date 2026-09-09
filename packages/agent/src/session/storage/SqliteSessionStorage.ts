/**
 * 单个 Session 的 SQLite 持久化实现。
 *
 * 本模块拥有数据库连接和事务；Message 领域只接收聚合对象，不感知 messages 与
 * message_parts 的关系结构。Composer 只能通过带 namespace 的派生存储操作自己的表。
 */

import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  SessionAgentInteractionPart,
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionMessage,
  SessionOrigin,
} from "@downcity/type";
import { restore_session_origin } from "@downcity/type";
import type { FileSystem, StorageDatabaseLocation } from "@downcity/type";
import type { SessionHistoryMeta } from "@/executor/types/SessionHistoryMeta.js";
import { normalize_session_metadata, resolve_system_timezone } from "@/session/storage/Metadata.js";
import { resolve_session_message_preview } from "@/session/preview/SessionMessagePreview.js";
import {
  decode_session_message,
  encode_session_message_row,
  encode_session_part_row,
  type SessionMessagePartRow,
  type SessionMessageRow,
} from "@/session/storage/SessionStorageCodec.js";
import {
  SESSION_STORAGE_SCHEMA_SQL,
  SESSION_STORAGE_SCHEMA_VERSION,
} from "@/session/storage/SessionStorageSchema.js";
import type {
  SessionComposerStorage,
  SessionComposerStorageTransaction,
  SessionMessageCreateState,
  SessionMessageStorageStats,
  SessionStorage,
  SessionStorageValue,
} from "@/types/store/SessionStorage.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

/** SQLite SessionStorage 构造参数。 */
export interface SqliteSessionStorageOptions {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 所属 Agent。 */
  agent_id: string;
  /** 当前 Session 绑定的 Workspace。 */
  workspace_id?: string;
  /** 当前 Session 的不可变来源。 */
  origin: SessionOrigin;
  /** 数据库文件路径；内存模式只用于诊断和附件目录定位。 */
  database_path: string;
  /** 使用本地文件或进程内数据库。 */
  database_location: StorageDatabaseLocation;
  /** 当前 Agent 私有文件能力。 */
  files: FileSystem;
  /** 当前 Session 的附件存储。 */
  attachments: SessionAttachmentStore;
}

/** 单个 Session 的 SQLite 存储。 */
export class SqliteSessionStorage implements SessionStorage {
  readonly session_id: string;
  readonly origin: SessionOrigin;
  readonly attachments: SessionAttachmentStore;

  private readonly agent_id: string;
  private readonly workspace_id?: string;
  private readonly database_path: string;
  private readonly database_location: StorageDatabaseLocation;
  private readonly files: FileSystem;
  private database: DatabaseSync | null = null;
  private initialize_promise: Promise<void> | null = null;
  private disposed = false;

  constructor(options: SqliteSessionStorageOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.agent_id = String(options.agent_id || "").trim();
    this.workspace_id = String(options.workspace_id || "").trim() || undefined;
    this.origin = structuredClone(options.origin);
    this.database_path = path.resolve(options.database_path);
    this.database_location = options.database_location;
    this.files = options.files;
    this.attachments = options.attachments;
    if (!this.session_id || !this.agent_id) {
      throw new Error("SqliteSessionStorage requires session_id and agent_id");
    }
  }

  /** 初始化数据库、校验身份并收口中断运行态。 */
  async initialize(): Promise<void> {
    if (!this.initialize_promise) this.initialize_promise = this.initialize_storage();
    const initialize_promise = this.initialize_promise;
    try {
      await initialize_promise;
    } catch (error) {
      if (this.initialize_promise === initialize_promise) this.initialize_promise = null;
      throw error;
    }
  }

  /** 读取当前 Session metadata 投影。 */
  async read_metadata(): Promise<SessionHistoryMeta> {
    await this.initialize();
    const row = this.require_database().prepare(`
      SELECT session_id, agent_id, workspace_id, origin, timezone, title,
             model_label, approval_mode, message_count, preview_text,
             created_at, updated_at
      FROM session_state WHERE singleton_id = 1
    `).get() as SessionStateRow | undefined;
    if (!row) throw new Error(`Session state does not exist: ${this.session_id}`);
    return normalize_session_metadata({
      v: 2,
      session_id: row.session_id,
      agent_id: row.agent_id,
      ...(row.workspace_id ? { workspace_id: row.workspace_id } : {}),
      origin: restore_session_origin(JSON.parse(row.origin), this.origin.type),
      timezone: row.timezone,
      ...(row.title ? { title: row.title } : {}),
      ...(row.model_label ? { model_label: row.model_label } : {}),
      ...(row.approval_mode ? { approval_mode: row.approval_mode } : {}),
      message_count: row.message_count,
      ...(row.preview_text ? { preview_text: row.preview_text } : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }, this.session_id, this.agent_id, this.origin, row.workspace_id || undefined);
  }

  /** 原子覆盖 configured metadata，同时保持数据库身份不变量。 */
  async write_metadata(metadata: SessionHistoryMeta): Promise<void> {
    await this.initialize();
    const normalized = normalize_session_metadata(
      metadata,
      this.session_id,
      this.agent_id,
      this.origin,
      metadata.workspace_id,
    );
    this.run_transaction(() => {
      const result = this.require_database().prepare(`
        UPDATE session_state SET
          workspace_id = ?, timezone = ?, title = ?, model_label = ?,
          approval_mode = ?,
          revision = revision + 1, updated_at = ?
        WHERE singleton_id = 1 AND session_id = ? AND agent_id = ? AND origin = ?
      `).run(
        normalized.workspace_id ?? null,
        normalized.timezone ?? resolve_system_timezone(),
        normalized.title ?? null,
        normalized.model_label ?? null,
        normalized.approval_mode ?? null,
        normalized.updated_at,
        this.session_id,
        this.agent_id,
        JSON.stringify(this.origin),
      );
      if (result.changes !== 1) throw new Error(`Session identity mismatch: ${this.session_id}`);
    });
  }

  /** 判断是否存在显式 system snapshot。 */
  async has_instruction(): Promise<boolean> {
    return (await this.read_instruction()) !== null;
  }

  /** 读取显式 system snapshot。 */
  async read_instruction(): Promise<string | null> {
    await this.initialize();
    const row = this.require_database().prepare(
      "SELECT system_snapshot FROM session_state WHERE singleton_id = 1",
    ).get() as { system_snapshot: string | null } | undefined;
    return row?.system_snapshot ?? null;
  }

  /** 原子写入显式 system snapshot。 */
  async write_instruction(instruction: string): Promise<void> {
    await this.initialize();
    const value = String(instruction || "").trim();
    if (!value) throw new Error("Session system snapshot cannot be empty");
    this.run_transaction(() => {
      this.require_database().prepare(`
        UPDATE session_state
        SET system_snapshot = ?, revision = revision + 1, updated_at = ?
        WHERE singleton_id = 1
      `).run(value, Date.now());
    });
  }

  /** 读取全部 Message 聚合。 */
  async list_messages(): Promise<SessionMessage[]> {
    await this.initialize();
    const rows = this.require_database().prepare(
      "SELECT * FROM messages ORDER BY sequence ASC",
    ).all() as unknown as SessionMessageRow[];
    return this.read_aggregates(rows);
  }

  /** 读取指定 Message 聚合。 */
  async read_message(message_id: string): Promise<SessionMessage | null> {
    await this.initialize();
    const row = this.require_database().prepare(
      "SELECT * FROM messages WHERE message_id = ?",
    ).get(message_id) as unknown as SessionMessageRow | undefined;
    return row ? this.read_aggregates([row])[0] ?? null : null;
  }

  /** 分配全局 sequence 并创建完整 Message 聚合。 */
  async create_message(
    build_message: (state: SessionMessageCreateState) => SessionMessage,
  ): Promise<SessionMessage> {
    await this.initialize();
    return this.run_transaction(() => {
      const messages = this.read_all_aggregates_unsafe();
      const message = build_message({
        message_sequence: (messages.at(-1)?.sequence ?? 0) + 1,
        messages,
      });
      this.validate_new_message(message, messages);
      this.insert_message_unsafe(message);
      this.refresh_message_projection_unsafe(message.updated_at);
      return structuredClone(message);
    });
  }

  /** 使用 expected revision 更新 Message envelope 与 Part 差异。 */
  async update_message(
    message_id: string,
    expected_revision: number,
    build_message: (current: SessionMessage) => SessionMessage,
  ): Promise<SessionMessage> {
    await this.initialize();
    return this.run_transaction(() => {
      const current = this.read_aggregate_unsafe(message_id);
      if (!current) throw new Error(`Session Message not found: ${message_id}`);
      if (current.revision !== expected_revision) {
        throw new Error(`Session Message revision conflict: ${message_id}`);
      }
      const message = build_message(structuredClone(current));
      this.validate_updated_message(current, message);
      this.update_message_unsafe(message, current.revision);
      this.refresh_message_projection_unsafe(message.updated_at);
      return structuredClone(message);
    });
  }

  /** 按 Message sequence 向前分页并返回升序聚合。 */
  async list_message_page(input?: {
    before_sequence?: number;
    limit?: number;
  }): Promise<SessionMessage[]> {
    await this.initialize();
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
    const before_sequence = input?.before_sequence;
    const rows = before_sequence === undefined
      ? this.require_database().prepare(
          "SELECT * FROM messages ORDER BY sequence DESC LIMIT ?",
        ).all(limit)
      : this.require_database().prepare(
          "SELECT * FROM messages WHERE sequence < ? ORDER BY sequence DESC LIMIT ?",
        ).all(before_sequence, limit);
    return this.read_aggregates((rows as unknown as SessionMessageRow[]).reverse());
  }

  /** 读取当前 Message 数量、数据库大小与最新 Message。 */
  async message_stats(): Promise<SessionMessageStorageStats> {
    await this.initialize();
    const count_row = this.require_database().prepare(
      "SELECT COUNT(*) AS message_count FROM messages",
    ).get() as { message_count: number };
    const latest_row = this.require_database().prepare(
      "SELECT * FROM messages ORDER BY sequence DESC LIMIT 1",
    ).get() as unknown as SessionMessageRow | undefined;
    const storage_bytes = this.database_location.type === "file"
      ? await this.files.file_size(this.database_path).catch(() => 0)
      : 0;
    return {
      message_count: count_row.message_count,
      storage_bytes,
      latest_message: latest_row ? this.read_aggregates([latest_row])[0] ?? null : null,
    };
  }

  /** 清空 Message；外键负责同步删除 Part 与正确关联的派生数据。 */
  async clear_messages(): Promise<void> {
    await this.initialize();
    this.run_transaction(() => {
      this.require_database().exec("DELETE FROM messages");
      this.require_database().prepare(`
        UPDATE session_state SET
          message_count = 0, preview_text = NULL,
          revision = revision + 1, updated_at = ?
        WHERE singleton_id = 1
      `).run(Date.now());
    });
  }

  /** 创建只允许当前 namespace 派生表的 Composer 存储。 */
  composer_storage(namespace: string): SessionComposerStorage {
    const normalized_namespace = normalize_composer_namespace(namespace);
    const table_prefix = `composer_${normalized_namespace}_`;
    return {
      list_messages: async () => await this.list_messages(),
      transaction: async <T>(operation: (transaction: SessionComposerStorageTransaction) => T) => {
        await this.initialize();
        return this.run_transaction(() => operation({
          execute: (sql, parameters) => {
            assert_policy_sql(sql, table_prefix);
            this.run_statement(sql, parameters);
          },
          get: <TRow>(sql: string, parameters?: readonly SessionStorageValue[]) => {
            assert_policy_sql(sql, table_prefix);
            return (this.get_statement(sql, parameters) as TRow | undefined) ?? null;
          },
          all: <TRow>(sql: string, parameters?: readonly SessionStorageValue[]) => {
            assert_policy_sql(sql, table_prefix);
            return this.all_statement(sql, parameters) as TRow[];
          },
        }));
      },
    };
  }

  /** 关闭 SQLite 连接。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const database = this.database;
    this.database = null;
    if (database) database.close();
  }

  /** 执行一次完整初始化。 */
  private async initialize_storage(): Promise<void> {
    if (this.disposed) throw new Error(`SessionStorage is disposed: ${this.session_id}`);
    if (this.database_location.type === "file") {
      await this.files.ensure_directory(path.dirname(this.database_path));
    }
    const database = new DatabaseSync(
      this.database_location.type === "file" ? this.database_path : ":memory:",
    );
    this.database = database;
    try {
      database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      if (this.database_location.type === "file") {
        database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
      }
      const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
      if (version > SESSION_STORAGE_SCHEMA_VERSION) {
        throw new Error(`Unsupported Session schema version: ${String(version)}`);
      }
      database.exec(SESSION_STORAGE_SCHEMA_SQL);
      database.exec(`PRAGMA user_version = ${String(SESSION_STORAGE_SCHEMA_VERSION)}`);
      this.initialize_identity_unsafe();
      this.recover_interrupted_messages_unsafe();
    } catch (error) {
      if (this.database === database) this.database = null;
      try {
        database.close();
      } catch {
        // 初始化错误优先；关闭失败不覆盖真正原因。
      }
      throw error;
    }
  }

  /** 创建或验证 Session 唯一状态行。 */
  private initialize_identity_unsafe(): void {
    this.run_transaction(() => {
      const database = this.require_database();
      const current = database.prepare(
        "SELECT session_id, agent_id, workspace_id, origin FROM session_state WHERE singleton_id = 1",
      ).get() as Pick<SessionStateRow, "session_id" | "agent_id" | "workspace_id" | "origin"> | undefined;
      if (!current) {
        const created_at = Date.now();
        database.prepare(`
          INSERT INTO session_state (
            singleton_id, session_id, agent_id, workspace_id, origin, timezone,
            message_count, revision, created_at, updated_at
          ) VALUES (1, ?, ?, ?, ?, ?, 0, 1, ?, ?)
        `).run(
          this.session_id,
          this.agent_id,
          this.workspace_id ?? null,
          JSON.stringify(this.origin),
          resolve_system_timezone(),
          created_at,
          created_at,
        );
        return;
      }
      if (
        current.session_id !== this.session_id ||
        current.agent_id !== this.agent_id ||
        current.origin !== JSON.stringify(this.origin)
      ) {
        throw new Error(`Session identity mismatch: ${this.session_id}`);
      }
    });
  }

  /** 收口上次进程中断遗留的 Message 与 Part 状态。 */
  private recover_interrupted_messages_unsafe(): void {
    this.run_transaction(() => {
      const messages = this.read_all_aggregates_unsafe();
      let recovered_any = false;
      for (const current of messages) {
        if (current.role !== "agent") continue;
        let changed = current.status === "streaming";
        const updated_at = Date.now();
        const parts = current.parts.map((part): SessionAgentMessagePart => {
          if (part.type === "action" && part.state === "running") {
            changed = true;
            return { ...part, state: "failed", description: part.description || "Action interrupted before completion." };
          }
          if (part.type === "interaction" && part.status === "pending") {
            changed = true;
            return {
              ...part,
              status: "cancelled",
              cancel_reason: "runtime_interrupted",
              resolved_at: updated_at,
            } satisfies SessionAgentInteractionPart;
          }
          if (
            part.type === "tool" &&
            part.state !== "completed" &&
            part.state !== "failed"
          ) {
            changed = true;
            return { ...part, state: "failed", error: "Tool interrupted before completion." };
          }
          if (
            (part.type === "text" || part.type === "reasoning") &&
            part.state === "streaming"
          ) {
            changed = true;
            return { ...part, state: "done" };
          }
          return part;
        });
        if (!changed) continue;
        const recovered: SessionAgentMessage = {
          ...current,
          status: current.status === "streaming" ? "stopped" : current.status,
          revision: current.revision + 1,
          updated_at,
          parts,
        };
        this.update_message_unsafe(recovered, current.revision);
        recovered_any = true;
      }
      if (recovered_any) this.refresh_message_projection_unsafe(Date.now());
    });
  }

  /** 批量读取 Message rows 对应的所有 Parts 并组装聚合。 */
  private read_aggregates(rows: readonly SessionMessageRow[]): SessionMessage[] {
    if (rows.length === 0) return [];
    const placeholders = rows.map(() => "?").join(", ");
    const part_rows = this.require_database().prepare(`
      SELECT * FROM message_parts
      WHERE message_id IN (${placeholders})
      ORDER BY message_id ASC, sequence ASC
    `).all(...rows.map((row) => row.message_id)) as unknown as SessionMessagePartRow[];
    const parts_by_message = new Map<string, SessionMessagePartRow[]>();
    for (const part of part_rows) {
      const parts = parts_by_message.get(part.message_id) || [];
      parts.push(part);
      parts_by_message.set(part.message_id, parts);
    }
    return rows.map((row) => decode_session_message(
      row,
      parts_by_message.get(row.message_id) || [],
      this.session_id,
    ));
  }

  /** 在当前事务中读取全部 Message 聚合。 */
  private read_all_aggregates_unsafe(): SessionMessage[] {
    const rows = this.require_database().prepare(
      "SELECT * FROM messages ORDER BY sequence ASC",
    ).all() as unknown as SessionMessageRow[];
    return this.read_aggregates(rows);
  }

  /** 在当前事务中读取单个 Message 聚合。 */
  private read_aggregate_unsafe(message_id: string): SessionMessage | null {
    const row = this.require_database().prepare(
      "SELECT * FROM messages WHERE message_id = ?",
    ).get(message_id) as unknown as SessionMessageRow | undefined;
    return row ? this.read_aggregates([row])[0] ?? null : null;
  }

  /** 插入 Message envelope 与全部 Parts。 */
  private insert_message_unsafe(message: SessionMessage): void {
    const row = encode_session_message_row(message);
    this.require_database().prepare(`
      INSERT INTO messages (
        message_id, turn_id, sequence, revision, role, input_type, status,
        visibility, origin_session_id, origin_message_id, origin_turn_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.message_id, row.turn_id, row.sequence, row.revision, row.role,
      row.input_type, row.status, row.visibility, row.origin_session_id,
      row.origin_message_id, row.origin_turn_id, row.created_at, row.updated_at,
    );
    for (const part of message.parts) this.insert_part_unsafe(message, part);
  }

  /** 更新 Message envelope 并只写入发生变化的 Part rows。 */
  private update_message_unsafe(message: SessionMessage, expected_revision: number): void {
    const row = encode_session_message_row(message);
    const result = this.require_database().prepare(`
      UPDATE messages SET
        turn_id = ?, revision = ?, input_type = ?, status = ?, visibility = ?,
        updated_at = ?
      WHERE message_id = ? AND revision = ? AND role = ? AND sequence = ?
    `).run(
      row.turn_id, row.revision, row.input_type, row.status, row.visibility,
      row.updated_at, row.message_id, expected_revision, row.role, row.sequence,
    );
    if (result.changes !== 1) {
      throw new Error(`Session Message revision conflict: ${message.message_id}`);
    }
    const existing_rows = this.require_database().prepare(
      "SELECT * FROM message_parts WHERE message_id = ? ORDER BY sequence",
    ).all(message.message_id) as unknown as SessionMessagePartRow[];
    const existing_by_id = new Map(existing_rows.map((part) => [part.part_id, part]));
    const next_rows = message.parts.map((part) => {
      const row = encode_session_part_row(message, part);
      return {
        ...row,
        created_at: existing_by_id.get(row.part_id)?.created_at ?? message.updated_at,
      };
    });
    const next_ids = new Set(next_rows.map((part) => part.part_id));
    for (const existing of existing_rows) {
      if (!next_ids.has(existing.part_id)) {
        this.require_database().prepare("DELETE FROM message_parts WHERE part_id = ?").run(existing.part_id);
      }
    }
    for (const part of next_rows) {
      const existing = existing_by_id.get(part.part_id);
      if (!existing) {
        this.insert_part_row_unsafe(part);
        continue;
      }
      if (
        existing.sequence === part.sequence &&
        existing.step_id === part.step_id &&
        existing.type === part.type &&
        existing.content === part.content
      ) continue;
      this.require_database().prepare(`
        UPDATE message_parts SET
          sequence = ?, step_id = ?, type = ?, content = ?, updated_at = ?
        WHERE part_id = ? AND message_id = ?
      `).run(
        part.sequence, part.step_id, part.type, part.content,
        part.updated_at, part.part_id, part.message_id,
      );
    }
  }

  /** 插入一个领域 Part。 */
  private insert_part_unsafe(
    message: SessionMessage,
    part: SessionMessage["parts"][number],
  ): void {
    this.insert_part_row_unsafe(encode_session_part_row(message, part));
  }

  /** 插入已经编码的 Part row。 */
  private insert_part_row_unsafe(row: SessionMessagePartRow): void {
    this.require_database().prepare(`
      INSERT INTO message_parts (
        part_id, message_id, sequence, step_id, type, content, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.part_id, row.message_id, row.sequence, row.step_id,
      row.type, row.content, row.created_at, row.updated_at,
    );
  }

  /** 事务性刷新 Session 列表物化字段。 */
  private refresh_message_projection_unsafe(updated_at: number): void {
    const count = this.require_database().prepare(
      "SELECT COUNT(*) AS count FROM messages",
    ).get() as { count: number };
    const latest_row = this.require_database().prepare(
      "SELECT * FROM messages ORDER BY sequence DESC LIMIT 1",
    ).get() as unknown as SessionMessageRow | undefined;
    const latest_message = latest_row
      ? this.read_aggregates([latest_row])[0] ?? null
      : null;
    const preview_text = latest_message
      ? resolve_session_message_preview(latest_message).trim().slice(0, 180)
      : "";
    this.require_database().prepare(`
      UPDATE session_state SET
        message_count = ?, preview_text = ?,
        revision = revision + 1, updated_at = ?
      WHERE singleton_id = 1
    `).run(count.count, preview_text || null, updated_at);
  }

  /** 校验新 Message 身份、顺序和 Part 结构。 */
  private validate_new_message(message: SessionMessage, existing: SessionMessage[]): void {
    if (message.session_id !== this.session_id) throw new Error("Session Message session_id mismatch");
    if (message.sequence !== (existing.at(-1)?.sequence ?? 0) + 1 || message.revision !== 1) {
      throw new Error("New Session Message requires the next sequence and revision 1");
    }
    this.validate_parts(message);
  }

  /** 校验更新没有改变 Message identity 与 Part identity。 */
  private validate_updated_message(current: SessionMessage, message: SessionMessage): void {
    if (
      message.message_id !== current.message_id ||
      message.session_id !== current.session_id ||
      message.sequence !== current.sequence ||
      message.role !== current.role ||
      message.revision !== current.revision + 1 ||
      message.created_at !== current.created_at ||
      JSON.stringify(message.origin) !== JSON.stringify(current.origin)
    ) {
      throw new Error(`Session Message update changed immutable identity: ${current.message_id}`);
    }
    this.validate_parts(message);
  }

  /** 校验 Part identity、类型和连续顺序。 */
  private validate_parts(message: SessionMessage): void {
    const ids = new Set<string>();
    for (let index = 0; index < message.parts.length; index += 1) {
      const part = message.parts[index];
      if (!part.part_id || ids.has(part.part_id) || part.sequence !== index + 1) {
        throw new Error(`Invalid Session Part identity or sequence: ${part.part_id || "unknown"}`);
      }
      ids.add(part.part_id);
      const user_type = part.type === "text" || part.type === "context" || part.type === "file" || part.type === "data";
      if (message.role === "user" && !user_type) {
        throw new Error(`User Message cannot contain ${part.type} Part`);
      }
    }
  }

  /** 在当前连接上执行短同步事务。 */
  private run_transaction<T>(operation: () => T): T {
    const database = this.require_database();
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // 原始事务错误优先，ROLLBACK 失败由 SQLite 下次打开时恢复。
      }
      throw error;
    }
  }

  /** 执行带参数 SQL。 */
  private run_statement(sql: string, parameters?: readonly SessionStorageValue[]): void {
    this.require_database().prepare(sql).run(...to_sql_values(parameters));
  }

  /** 读取一条带参数 SQL。 */
  private get_statement(sql: string, parameters?: readonly SessionStorageValue[]): unknown {
    return this.require_database().prepare(sql).get(...to_sql_values(parameters));
  }

  /** 读取多条带参数 SQL。 */
  private all_statement(sql: string, parameters?: readonly SessionStorageValue[]): unknown[] {
    return this.require_database().prepare(sql).all(...to_sql_values(parameters));
  }

  /** 返回已经初始化且尚未释放的数据库连接。 */
  private require_database(): DatabaseSync {
    if (this.disposed) throw new Error(`SessionStorage is disposed: ${this.session_id}`);
    if (!this.database) throw new Error(`SessionStorage is not initialized: ${this.session_id}`);
    return this.database;
  }
}

/** session_state 查询行。 */
interface SessionStateRow {
  /** Session 标识。 */
  session_id: string;
  /** Agent 标识。 */
  agent_id: string;
  /** Workspace 标识。 */
  workspace_id: string | null;
  /** JSON 编码的 Session 来源。 */
  origin: string;
  /** Session 时区。 */
  timezone: string;
  /** Session 标题。 */
  title: string | null;
  /** 当前配置模型标签。 */
  model_label: string | null;
  /** Shell 审批模式。 */
  approval_mode: "ask" | "always-allow" | null;
  /** Message 数量投影。 */
  message_count: number;
  /** Session 列表预览。 */
  preview_text: string | null;
  /** Session 创建时间。 */
  created_at: number;
  /** Session 更新时间。 */
  updated_at: number;
}

/** 校验 Composer 派生表 namespace。 */
function normalize_composer_namespace(value: string): string {
  const namespace = String(value || "").trim();
  if (!/^[a-z][a-z0-9_]*$/u.test(namespace)) {
    throw new Error("Composer storage namespace must use lowercase snake_case");
  }
  return namespace;
}

/** 限制派生 SQL 的写目标，避免内置 Policy 修改 canonical 表。 */
function assert_policy_sql(sql: string, table_prefix: string): void {
  const source = String(sql || "").trim();
  if (!source) throw new Error("Composer storage SQL cannot be empty");
  if (/\b(?:ATTACH|DETACH|VACUUM|PRAGMA|REINDEX|ANALYZE)\b/iu.test(source)) {
    throw new Error("Composer Policy cannot execute database control statements");
  }
  const mutation_targets = [
    ...source.matchAll(/\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
    ...source.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
    ...source.matchAll(/\bCREATE\s+TRIGGER(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
    ...source.matchAll(/\bINSERT(?:\s+OR\s+(?:ROLLBACK|ABORT|REPLACE|FAIL|IGNORE))?\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
    ...source.matchAll(/\bREPLACE\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
    ...source.matchAll(/\bUPDATE(?:\s+OR\s+(?:ROLLBACK|ABORT|REPLACE|FAIL|IGNORE))?\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
    ...source.matchAll(/\bDELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
    ...source.matchAll(/\bDROP\s+(?:TABLE|INDEX|TRIGGER)(?:\s+IF\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
    ...source.matchAll(/\bALTER\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)/giu),
  ].map((match) => match[1] || "");
  const mutates_database = /\b(?:CREATE|INSERT|REPLACE|UPDATE|DELETE|DROP|ALTER)\b/iu.test(source);
  if (mutates_database && mutation_targets.length === 0) {
    throw new Error("Composer Policy SQL mutation is not supported");
  }
  if (mutation_targets.some((table_name) => !table_name.startsWith(table_prefix))) {
    throw new Error(`Composer Policy can only mutate ${table_prefix}* tables`);
  }
}

/** 把领域 SQL 标量转换为 node:sqlite 参数。 */
function to_sql_values(values?: readonly SessionStorageValue[]): SQLInputValue[] {
  return (values || []).map((value) => value as SQLInputValue);
}
