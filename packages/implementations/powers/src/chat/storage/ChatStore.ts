/** Chat Power Conversation、Inbox、Outbox 与 Activity 的唯一 SQLite Store。 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "fs-extra";
import { generate_id } from "@downcity/agent";
import type {
  ChatActivityRecord,
  ChatActivityType,
  ChatConversationRecord,
  ChatInboundMessage,
  ChatInboxRecord,
  ChatOutboxRecord,
} from "@/chat/types/ChatReliability.js";

type SqlRow = Record<string, unknown>;

const CHAT_STORE_SCHEMA_VERSION = "1";

/** 返回 Chat Power 生命周期数据库的绝对路径。 */
export function get_chat_store_path(storage_path: string): string {
  return path.join(path.resolve(storage_path), "chat.db");
}

/** Chat Power 可靠消息状态的 SQLite 实现。 */
export class ChatStore {
  /** 当前 Store 持有的唯一数据库连接。 */
  private readonly database: DatabaseSync;

  /** 打开数据库并确保 Schema 可用。 */
  constructor(storage_path: string) {
    const database_path = get_chat_store_path(storage_path);
    fs.ensureDirSync(path.dirname(database_path), { mode: 0o700 });
    this.database = new DatabaseSync(database_path);
    ensure_schema(this.database);
    try {
      fs.chmodSync(database_path, 0o600);
    } catch {
      // 非 POSIX 文件系统可能不支持 chmod，数据库仍可正常使用。
    }
  }

  /** 关闭当前 Store 持有的数据库连接。 */
  close(): void {
    this.database.close();
  }

  /** 在一个立即事务中执行同步数据库操作。 */
  transaction<TResult>(operation: () => TResult): TResult {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  /** 列出全部 Conversation，默认按最近消息倒序。 */
  list_conversations(account_id?: string): ChatConversationRecord[] {
    const normalized_account_id = normalize_text(account_id);
    const rows = normalized_account_id
      ? this.database.prepare(`
          SELECT * FROM chat_conversations
          WHERE account_id = ?
          ORDER BY COALESCE(last_message_at, updated_at) DESC
        `).all(normalized_account_id) as SqlRow[]
      : this.database.prepare(`
          SELECT * FROM chat_conversations
          ORDER BY COALESCE(last_message_at, updated_at) DESC
        `).all() as SqlRow[];
    return rows.map(to_conversation);
  }

  /** 列出当前 Agent 拥有的全部 Conversation。 */
  list_agent_conversations(agent_id: string): ChatConversationRecord[] {
    const rows = this.database.prepare(`
      SELECT * FROM chat_conversations
      WHERE agent_id = ? ORDER BY COALESCE(last_message_at, updated_at) DESC
    `).all(normalize_required(agent_id, "agent_id")) as SqlRow[];
    return rows.map(to_conversation);
  }

  /** 按 Agent Session ID 读取 Conversation。 */
  get_conversation_by_session(session_id: string): ChatConversationRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_conversations WHERE session_id = ? LIMIT 1
    `).get(normalize_required(session_id, "session_id")) as SqlRow | undefined;
    return row ? to_conversation(row) : null;
  }

  /** 按内部 ID 读取 Conversation。 */
  get_conversation(conversation_id: string): ChatConversationRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_conversations WHERE conversation_id = ? LIMIT 1
    `).get(normalize_required(conversation_id, "conversation_id")) as SqlRow | undefined;
    return row ? to_conversation(row) : null;
  }

  /** 按外部平台路由读取 Conversation。 */
  find_conversation(input: {
    /** Bot Account ID。 */
    account_id: string;
    /** 平台原始会话 ID。 */
    external_chat_id: string;
    /** 平台会话类型。 */
    chat_type: string;
    /** 可选 Thread/Topic ID。 */
    thread_id?: string;
  }): ChatConversationRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_conversations
      WHERE account_id = ? AND external_chat_id = ? AND chat_type = ? AND thread_key = ?
      LIMIT 1
    `).get(
      normalize_required(input.account_id, "account_id"),
      normalize_required(input.external_chat_id, "external_chat_id"),
      normalize_required(input.chat_type, "chat_type"),
      normalize_text(input.thread_id),
    ) as SqlRow | undefined;
    return row ? to_conversation(row) : null;
  }

  /** 解析或创建一个稳定的外部 Conversation 映射。 */
  resolve_conversation(input: {
    /** 当前 Bot Account。 */
    account_id: string;
    /** 平台原始会话 ID。 */
    external_chat_id: string;
    /** 平台会话类型。 */
    chat_type: string;
    /** 可选 Thread/Topic ID。 */
    thread_id?: string;
    /** 最近观测到的会话标题。 */
    title?: string;
    /** 新映射默认使用的 Agent。 */
    agent_id: string;
    /** 新映射默认使用的 Workspace。 */
    workspace_id: string;
    /** 新映射使用的 Session ID。 */
    session_id: string;
    /** 最近一条消息的时间。 */
    last_message_at: number;
  }): ChatConversationRecord {
    const account_id = normalize_required(input.account_id, "account_id");
    const external_chat_id = normalize_required(input.external_chat_id, "external_chat_id");
    const chat_type = normalize_required(input.chat_type, "chat_type");
    const thread_id = normalize_text(input.thread_id);
    const existing_row = this.database.prepare(`
      SELECT * FROM chat_conversations
      WHERE account_id = ? AND external_chat_id = ? AND chat_type = ? AND thread_key = ?
      LIMIT 1
    `).get(account_id, external_chat_id, chat_type, thread_id) as SqlRow | undefined;
    const current_time = Date.now();
    if (existing_row) {
      const existing = to_conversation(existing_row);
      this.database.prepare(`
        UPDATE chat_conversations
        SET title = COALESCE(?, title), last_message_at = ?, updated_at = ?
        WHERE conversation_id = ?
      `).run(normalize_text(input.title) || null, input.last_message_at, current_time, existing.conversation_id);
      return this.get_conversation(existing.conversation_id) ?? existing;
    }

    const conversation_id = `conversation_${generate_id()}`;
    this.database.prepare(`
      INSERT INTO chat_conversations (
        conversation_id, account_id, external_chat_id, chat_type, thread_key,
        title, agent_id, workspace_id, session_id, status,
        last_message_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      conversation_id,
      account_id,
      external_chat_id,
      chat_type,
      thread_id,
      normalize_text(input.title) || null,
      normalize_required(input.agent_id, "agent_id"),
      normalize_required(input.workspace_id, "workspace_id"),
      normalize_required(input.session_id, "session_id"),
      input.last_message_at,
      current_time,
      current_time,
    );
    const created = this.get_conversation(conversation_id);
    if (!created) throw new Error("Failed to create Chat conversation");
    return created;
  }

  /** 更新 Conversation 的执行路由或状态。 */
  update_conversation(input: {
    /** 目标 Conversation ID。 */
    conversation_id: string;
    /** 新 Agent ID。 */
    agent_id?: string;
    /** 新 Workspace ID。 */
    workspace_id?: string;
    /** 新 Session ID。 */
    session_id?: string;
    /** 新状态。 */
    status?: "active" | "paused";
  }): ChatConversationRecord {
    const current = this.get_conversation(input.conversation_id);
    if (!current) throw new Error(`Chat conversation not found: ${input.conversation_id}`);
    const agent_id = normalize_text(input.agent_id) || current.agent_id;
    const workspace_id = normalize_text(input.workspace_id) || current.workspace_id;
    const session_id = normalize_text(input.session_id) || current.session_id;
    const status = input.status ?? current.status;
    this.database.prepare(`
      UPDATE chat_conversations
      SET agent_id = ?, workspace_id = ?, session_id = ?, status = ?, updated_at = ?
      WHERE conversation_id = ?
    `).run(agent_id, workspace_id, session_id, status, Date.now(), current.conversation_id);
    return this.get_conversation(current.conversation_id) ?? current;
  }

  /** 删除一个 Account 的所有 Conversation 与可靠收发状态。 */
  delete_account_data(account_id: string): void {
    const normalized_account_id = normalize_required(account_id, "account_id");
    this.transaction(() => {
      this.database.prepare("DELETE FROM chat_activity WHERE account_id = ?").run(normalized_account_id);
      this.database.prepare("DELETE FROM chat_outbox WHERE account_id = ?").run(normalized_account_id);
      this.database.prepare("DELETE FROM chat_inbox WHERE account_id = ?").run(normalized_account_id);
      this.database.prepare("DELETE FROM chat_conversations WHERE account_id = ?").run(normalized_account_id);
    });
  }

  /** 幂等写入标准化入站消息。 */
  insert_inbound(message: ChatInboundMessage): { record: ChatInboxRecord; inserted: boolean } {
    const account_id = normalize_required(message.account_id, "account_id");
    const external_message_id = normalize_required(message.external_message_id, "external_message_id");
    const existing = this.get_inbound_by_external_id(account_id, external_message_id);
    if (existing) return { record: existing, inserted: false };
    const current_time = Date.now();
    const inbound_id = `inbound_${generate_id()}`;
    this.database.prepare(`
      INSERT INTO chat_inbox (
        inbound_id, account_id, external_message_id, payload_json, status,
        attempt_count, available_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'received', 0, ?, ?, ?)
    `).run(
      inbound_id,
      account_id,
      external_message_id,
      JSON.stringify(message),
      current_time,
      current_time,
      current_time,
    );
    const record = this.get_inbound(inbound_id);
    if (!record) throw new Error("Failed to persist Chat inbound message");
    return { record, inserted: true };
  }

  /** 读取一条 Inbox 记录。 */
  get_inbound(inbound_id: string): ChatInboxRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_inbox WHERE inbound_id = ? LIMIT 1
    `).get(normalize_required(inbound_id, "inbound_id")) as SqlRow | undefined;
    return row ? to_inbox(row) : null;
  }

  /** 按平台消息幂等键读取 Inbox。 */
  get_inbound_by_external_id(account_id: string, external_message_id: string): ChatInboxRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_inbox
      WHERE account_id = ? AND external_message_id = ? LIMIT 1
    `).get(
      normalize_required(account_id, "account_id"),
      normalize_required(external_message_id, "external_message_id"),
    ) as SqlRow | undefined;
    return row ? to_inbox(row) : null;
  }

  /** 将已通过 Access 的消息绑定 Conversation 并置为待处理。 */
  accept_inbound(inbound_id: string, conversation_id: string): void {
    this.database.prepare(`
      UPDATE chat_inbox
      SET conversation_id = ?, status = 'pending', available_at = ?,
          lease_expires_at = NULL, error = NULL, updated_at = ?
      WHERE inbound_id = ?
    `).run(
      normalize_required(conversation_id, "conversation_id"),
      Date.now(),
      Date.now(),
      normalize_required(inbound_id, "inbound_id"),
    );
  }

  /** 领取下一条可执行 Inbox，并为其建立有限时 lease。 */
  lease_next_inbound(lease_duration_ms: number): ChatInboxRecord | null {
    return this.transaction(() => {
      const current_time = Date.now();
      const row = this.database.prepare(`
        SELECT inbox.* FROM chat_inbox inbox
        WHERE inbox.status IN ('received', 'pending', 'retry_wait')
          AND inbox.available_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM chat_inbox active
            WHERE active.conversation_id = inbox.conversation_id
              AND active.status = 'processing'
              AND active.lease_expires_at > ?
          )
        ORDER BY inbox.created_at ASC
        LIMIT 1
      `).get(current_time, current_time) as SqlRow | undefined;
      if (!row) return null;
      const inbound_id = normalize_required(row.inbound_id, "inbound_id");
      this.database.prepare(`
        UPDATE chat_inbox
        SET status = 'processing', attempt_count = attempt_count + 1,
            lease_expires_at = ?, updated_at = ?
        WHERE inbound_id = ?
      `).run(current_time + lease_duration_ms, current_time, inbound_id);
      return this.get_inbound(inbound_id);
    });
  }

  /** 标记 Inbox 已完成 Agent 执行与 Outbox 提交。 */
  complete_inbound(inbound_id: string): void {
    this.database.prepare(`
      UPDATE chat_inbox
      SET status = 'processed', lease_expires_at = NULL, error = NULL, updated_at = ?
      WHERE inbound_id = ?
    `).run(Date.now(), normalize_required(inbound_id, "inbound_id"));
  }

  /** 按是否仍可重试记录 Inbox 执行失败。 */
  fail_inbound(inbound_id: string, error: unknown, retry_at?: number): void {
    this.database.prepare(`
      UPDATE chat_inbox
      SET status = ?, available_at = ?, lease_expires_at = NULL, error = ?, updated_at = ?
      WHERE inbound_id = ?
    `).run(
      typeof retry_at === "number" ? "retry_wait" : "failed",
      retry_at ?? Date.now(),
      normalize_error(error),
      Date.now(),
      normalize_required(inbound_id, "inbound_id"),
    );
  }

  /** 列出一个 Account 当前需要人工处理的失败 Inbox。 */
  list_failed_inbound(account_id: string, limit = 100): ChatInboxRecord[] {
    const safe_limit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const rows = this.database.prepare(`
      SELECT * FROM chat_inbox
      WHERE account_id = ? AND status = 'failed'
      ORDER BY updated_at DESC LIMIT ?
    `).all(normalize_required(account_id, "account_id"), safe_limit) as SqlRow[];
    return rows.map(to_inbox);
  }

  /** 将一条人工确认重试的失败 Inbox 恢复为待领取状态。 */
  retry_inbound(inbound_id: string): boolean {
    const result = this.database.prepare(`
      UPDATE chat_inbox
      SET status = 'retry_wait', attempt_count = 0, available_at = ?,
          lease_expires_at = NULL, error = NULL, updated_at = ?
      WHERE inbound_id = ? AND status = 'failed'
    `).run(Date.now(), Date.now(), normalize_required(inbound_id, "inbound_id"));
    return Number(result.changes) > 0;
  }

  /** 把一条平台发送操作写入可靠 Outbox。 */
  insert_outbound(input: {
    /** 可选稳定投递 ID；用于把同一业务结果幂等提交到 Outbox。 */
    delivery_id?: string;
    /** 负责发送的 Bot Account。 */
    account_id: string;
    /** 目标 Conversation。 */
    conversation_id: string;
    /** 平台操作类型。 */
    operation: "text" | "attachment" | "reaction";
    /** 平台操作数据。 */
    payload: Record<string, unknown>;
    /** 最早允许发送的时间。 */
    available_at?: number;
  }): ChatOutboxRecord {
    const current_time = Date.now();
    const delivery_id = normalize_text(input.delivery_id) || `delivery_${generate_id()}`;
    this.database.prepare(`
      INSERT OR IGNORE INTO chat_outbox (
        delivery_id, account_id, conversation_id, operation, payload_json,
        status, attempt_count, available_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    `).run(
      delivery_id,
      normalize_required(input.account_id, "account_id"),
      normalize_required(input.conversation_id, "conversation_id"),
      input.operation,
      JSON.stringify(input.payload),
      input.available_at ?? current_time,
      current_time,
      current_time,
    );
    const created = this.get_outbound(delivery_id);
    if (!created) throw new Error("Failed to resolve Chat outbound delivery");
    return created;
  }

  /** 读取一条 Outbox 记录。 */
  get_outbound(delivery_id: string): ChatOutboxRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_outbox WHERE delivery_id = ? LIMIT 1
    `).get(normalize_required(delivery_id, "delivery_id")) as SqlRow | undefined;
    return row ? to_outbox(row) : null;
  }

  /** 领取下一条可发送 Outbox，并建立有限时 lease。 */
  lease_next_outbound(lease_duration_ms: number): ChatOutboxRecord | null {
    return this.transaction(() => {
      const current_time = Date.now();
      const row = this.database.prepare(`
        SELECT * FROM chat_outbox
        WHERE status IN ('pending', 'retry_wait') AND available_at <= ?
        ORDER BY created_at ASC LIMIT 1
      `).get(current_time) as SqlRow | undefined;
      if (!row) return null;
      const delivery_id = normalize_required(row.delivery_id, "delivery_id");
      this.database.prepare(`
        UPDATE chat_outbox
        SET status = 'sending', attempt_count = attempt_count + 1,
            lease_expires_at = ?, updated_at = ?
        WHERE delivery_id = ?
      `).run(current_time + lease_duration_ms, current_time, delivery_id);
      return this.get_outbound(delivery_id);
    });
  }

  /** 标记 Outbox 已由平台确认发送。 */
  complete_outbound(delivery_id: string, external_message_id?: string): void {
    this.database.prepare(`
      UPDATE chat_outbox
      SET status = 'delivered', external_message_id = ?, lease_expires_at = NULL,
          error = NULL, updated_at = ?
      WHERE delivery_id = ?
    `).run(
      normalize_text(external_message_id) || null,
      Date.now(),
      normalize_required(delivery_id, "delivery_id"),
    );
  }

  /**
   * 将一条 Outbox 重新排队，不消耗已用重试次数。
   *
   * 说明（中文）
   * - 用于“连接暂时不可用”这类与内容无关的障碍，避免把消息直接判死。
   * - 恢复连接后消息会自然被重新领取并投递。
   */
  requeue_outbound(delivery_id: string, delay_ms: number): void {
    const safe_delay_ms = Math.max(0, Math.trunc(delay_ms));
    this.database.prepare(`
      UPDATE chat_outbox
      SET status = 'retry_wait', attempt_count = MAX(0, attempt_count - 1),
          available_at = ?, lease_expires_at = NULL, updated_at = ?
      WHERE delivery_id = ? AND status = 'sending'
    `).run(
      Date.now() + safe_delay_ms,
      Date.now(),
      normalize_required(delivery_id, "delivery_id"),
    );
  }

  /** 按是否仍可重试记录 Outbox 投递失败。 */
  fail_outbound(delivery_id: string, error: unknown, retry_at?: number): void {
    this.database.prepare(`
      UPDATE chat_outbox
      SET status = ?, available_at = ?, lease_expires_at = NULL, error = ?, updated_at = ?
      WHERE delivery_id = ?
    `).run(
      typeof retry_at === "number" ? "retry_wait" : "failed",
      retry_at ?? Date.now(),
      normalize_error(error),
      Date.now(),
      normalize_required(delivery_id, "delivery_id"),
    );
  }

  /** 列出一个 Account 当前需要人工处理的失败 Outbox。 */
  list_failed_outbound(account_id: string, limit = 100): ChatOutboxRecord[] {
    const safe_limit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const rows = this.database.prepare(`
      SELECT * FROM chat_outbox
      WHERE account_id = ? AND status = 'failed'
      ORDER BY updated_at DESC LIMIT ?
    `).all(normalize_required(account_id, "account_id"), safe_limit) as SqlRow[];
    return rows.map(to_outbox);
  }

  /** 将一条人工确认重试的失败 Outbox 恢复为待领取状态。 */
  retry_outbound(delivery_id: string): boolean {
    const result = this.database.prepare(`
      UPDATE chat_outbox
      SET status = 'retry_wait', attempt_count = 0, available_at = ?,
          lease_expires_at = NULL, error = NULL, updated_at = ?
      WHERE delivery_id = ? AND status = 'failed'
    `).run(Date.now(), Date.now(), normalize_required(delivery_id, "delivery_id"));
    return Number(result.changes) > 0;
  }

  /** 将进程退出时遗留的过期 lease 恢复为可重试状态。 */
  recover_expired_leases(current_time = Date.now()): void {
    this.transaction(() => {
      this.database.prepare(`
        UPDATE chat_inbox
        SET status = 'retry_wait', available_at = ?, lease_expires_at = NULL, updated_at = ?
        WHERE status = 'processing' AND lease_expires_at <= ?
      `).run(current_time, current_time, current_time);
      this.database.prepare(`
        UPDATE chat_outbox
        SET status = 'retry_wait', available_at = ?, lease_expires_at = NULL, updated_at = ?
        WHERE status = 'sending' AND lease_expires_at <= ?
      `).run(current_time, current_time, current_time);
    });
  }

  /** 追加一条不包含敏感内容的诊断事件。 */
  append_activity(input: {
    /** 相关 Bot Account。 */
    account_id: string;
    /** 可选 Conversation。 */
    conversation_id?: string;
    /** Activity 类型。 */
    type: ChatActivityType;
    /** 非敏感结构化详情。 */
    detail?: Record<string, unknown>;
  }): ChatActivityRecord {
    const activity: ChatActivityRecord = {
      activity_id: `activity_${generate_id()}`,
      account_id: normalize_required(input.account_id, "account_id"),
      ...(normalize_text(input.conversation_id)
        ? { conversation_id: normalize_text(input.conversation_id) }
        : {}),
      type: input.type,
      detail: input.detail ?? {},
      created_at: Date.now(),
    };
    this.database.prepare(`
      INSERT INTO chat_activity (
        activity_id, account_id, conversation_id, type, detail_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      activity.activity_id,
      activity.account_id,
      activity.conversation_id ?? null,
      activity.type,
      JSON.stringify(activity.detail),
      activity.created_at,
    );
    return activity;
  }

  /** 读取一个 Account 最近的 Activity。 */
  list_activity(account_id: string, limit = 100): ChatActivityRecord[] {
    const safe_limit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const rows = this.database.prepare(`
      SELECT * FROM chat_activity
      WHERE account_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(normalize_required(account_id, "account_id"), safe_limit) as SqlRow[];
    return rows.map((row) => ({
      activity_id: normalize_required(row.activity_id, "activity_id"),
      account_id: normalize_required(row.account_id, "account_id"),
      ...(normalize_text(row.conversation_id)
        ? { conversation_id: normalize_text(row.conversation_id) }
        : {}),
      type: normalize_required(row.type, "type") as ChatActivityType,
      detail: parse_object(row.detail_json),
      created_at: to_number(row.created_at),
    }));
  }
}

/** 初始化 Chat Store Schema。 */
function ensure_schema(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_conversations (
      conversation_id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      external_chat_id TEXT NOT NULL,
      chat_type TEXT NOT NULL,
      thread_key TEXT NOT NULL DEFAULT '',
      title TEXT,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
      last_message_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (account_id, external_chat_id, chat_type, thread_key)
    );

    CREATE INDEX IF NOT EXISTS chat_conversations_account_idx
    ON chat_conversations(account_id, last_message_at DESC);

    CREATE TABLE IF NOT EXISTS chat_inbox (
      inbound_id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      conversation_id TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'received', 'pending', 'processing',
        'processed', 'retry_wait', 'failed'
      )),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      lease_expires_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (account_id, external_message_id),
      FOREIGN KEY (conversation_id)
        REFERENCES chat_conversations(conversation_id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS chat_inbox_ready_idx
    ON chat_inbox(status, available_at, created_at);

    CREATE TABLE IF NOT EXISTS chat_outbox (
      delivery_id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('text', 'attachment', 'reaction')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'pending', 'sending', 'retry_wait', 'delivered', 'failed'
      )),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      lease_expires_at INTEGER,
      external_message_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id)
        REFERENCES chat_conversations(conversation_id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS chat_outbox_ready_idx
    ON chat_outbox(status, available_at, created_at);

    CREATE TABLE IF NOT EXISTS chat_activity (
      activity_id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      conversation_id TEXT,
      type TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id)
        REFERENCES chat_conversations(conversation_id)
        ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS chat_activity_account_idx
    ON chat_activity(account_id, created_at DESC);
  `);
  database.prepare(`
    INSERT INTO chat_meta (key, value, updated_at)
    VALUES ('schema_version', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(CHAT_STORE_SCHEMA_VERSION, Date.now());
}

/** 把 SQL 行转换为 Conversation。 */
function to_conversation(row: SqlRow): ChatConversationRecord {
  const thread_id = normalize_text(row.thread_key);
  const title = normalize_text(row.title);
  const last_message_at = optional_number(row.last_message_at);
  return {
    conversation_id: normalize_required(row.conversation_id, "conversation_id"),
    account_id: normalize_required(row.account_id, "account_id"),
    external_chat_id: normalize_required(row.external_chat_id, "external_chat_id"),
    chat_type: normalize_required(row.chat_type, "chat_type"),
    ...(thread_id ? { thread_id } : {}),
    ...(title ? { title } : {}),
    agent_id: normalize_required(row.agent_id, "agent_id"),
    workspace_id: normalize_required(row.workspace_id, "workspace_id"),
    session_id: normalize_required(row.session_id, "session_id"),
    status: normalize_required(row.status, "status") as "active" | "paused",
    ...(last_message_at !== undefined ? { last_message_at } : {}),
    created_at: to_number(row.created_at),
    updated_at: to_number(row.updated_at),
  };
}

/** 把 SQL 行转换为 Inbox。 */
function to_inbox(row: SqlRow): ChatInboxRecord {
  const conversation_id = normalize_text(row.conversation_id);
  const lease_expires_at = optional_number(row.lease_expires_at);
  const error = normalize_text(row.error);
  return {
    inbound_id: normalize_required(row.inbound_id, "inbound_id"),
    account_id: normalize_required(row.account_id, "account_id"),
    external_message_id: normalize_required(row.external_message_id, "external_message_id"),
    ...(conversation_id ? { conversation_id } : {}),
    message: parse_object(row.payload_json) as unknown as ChatInboundMessage,
    status: normalize_required(row.status, "status") as ChatInboxRecord["status"],
    attempt_count: to_number(row.attempt_count),
    available_at: to_number(row.available_at),
    ...(lease_expires_at !== undefined ? { lease_expires_at } : {}),
    ...(error ? { error } : {}),
    created_at: to_number(row.created_at),
    updated_at: to_number(row.updated_at),
  };
}

/** 把 SQL 行转换为 Outbox。 */
function to_outbox(row: SqlRow): ChatOutboxRecord {
  const lease_expires_at = optional_number(row.lease_expires_at);
  const external_message_id = normalize_text(row.external_message_id);
  const error = normalize_text(row.error);
  return {
    delivery_id: normalize_required(row.delivery_id, "delivery_id"),
    account_id: normalize_required(row.account_id, "account_id"),
    conversation_id: normalize_required(row.conversation_id, "conversation_id"),
    operation: normalize_required(row.operation, "operation") as ChatOutboxRecord["operation"],
    payload: parse_object(row.payload_json),
    status: normalize_required(row.status, "status") as ChatOutboxRecord["status"],
    attempt_count: to_number(row.attempt_count),
    available_at: to_number(row.available_at),
    ...(lease_expires_at !== undefined ? { lease_expires_at } : {}),
    ...(external_message_id ? { external_message_id } : {}),
    ...(error ? { error } : {}),
    created_at: to_number(row.created_at),
    updated_at: to_number(row.updated_at),
  };
}

/** 读取非空字符串。 */
function normalize_required(value: unknown, field: string): string {
  const normalized = normalize_text(value);
  if (!normalized) throw new Error(`Chat Store field is required: ${field}`);
  return normalized;
}

/** 读取可选字符串。 */
function normalize_text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 读取有限数字。 */
function to_number(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new Error("Chat Store contains an invalid number");
  return normalized;
}

/** 读取可选有限数字。 */
function optional_number(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return to_number(value);
}

/** 解析一个 JSON Object。 */
function parse_object(value: unknown): Record<string, unknown> {
  const parsed = JSON.parse(String(value || "{}")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Chat Store JSON payload must be an object");
  }
  return parsed as Record<string, unknown>;
}

/** 把未知错误规范化为可持久化文本。 */
function normalize_error(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
