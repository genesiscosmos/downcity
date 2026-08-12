/**
 * Chat Access SQLite Schema。
 *
 * 关键点（中文）
 * - 所有表只保存当前 Agent 的 Chat 准入数据。
 * - 不保存 Bot Token、App Secret 或消息正文。
 * - WAL 与 busy_timeout 保证 Agent runtime 和 CLI 可以并发读写。
 */

import type { DatabaseSync } from "node:sqlite";

/** 当前 Chat Access Schema 版本。 */
export const CHAT_ACCESS_SCHEMA_VERSION = "1";

/**
 * 初始化 Chat Access Schema。
 */
export function ensure_chat_access_schema(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");

  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_access_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_access_principals (
      principal_id TEXT PRIMARY KEY NOT NULL,
      channel TEXT NOT NULL,
      issuer TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      display_name TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_chat_id TEXT,
      last_chat_type TEXT,
      UNIQUE (channel, issuer, subject_id)
    );

    CREATE TABLE IF NOT EXISTS chat_access_grants (
      grant_id TEXT PRIMARY KEY NOT NULL,
      principal_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('direct', 'group')),
      effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (principal_id, scope),
      FOREIGN KEY (principal_id)
        REFERENCES chat_access_principals(principal_id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_access_requests (
      request_id TEXT PRIMARY KEY NOT NULL,
      principal_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('direct', 'group')),
      chat_id TEXT NOT NULL,
      chat_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
      resolved_by TEXT,
      created_at TEXT NOT NULL,
      last_requested_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (principal_id)
        REFERENCES chat_access_principals(principal_id)
        ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS chat_access_requests_pending_uq
    ON chat_access_requests(principal_id, scope)
    WHERE status = 'pending';

    CREATE INDEX IF NOT EXISTS chat_access_requests_status_idx
    ON chat_access_requests(status, last_requested_at DESC);

    CREATE TABLE IF NOT EXISTS chat_access_audit_events (
      event_id TEXT PRIMARY KEY NOT NULL,
      principal_id TEXT,
      request_id TEXT,
      action TEXT NOT NULL,
      scope TEXT,
      decision TEXT,
      operator TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS chat_access_audit_created_idx
    ON chat_access_audit_events(created_at DESC);
  `);

  const current_time = new Date().toISOString();
  database.prepare(`
    INSERT INTO chat_access_meta (key, value, updated_at)
    VALUES ('schema_version', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(CHAT_ACCESS_SCHEMA_VERSION, current_time);
}
