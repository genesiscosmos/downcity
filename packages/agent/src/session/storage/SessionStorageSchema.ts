/**
 * Session SQLite 核心 schema。
 *
 * 这里只定义所有 Composer 共享的 canonical 表和持久化约束；任何摘要、索引或
 * 检索表都由具体 Composer 在自己的 namespace 中创建。
 */

import type { DatabaseSync } from "node:sqlite";
import { SESSION_STABLE_PREFIX_SCHEMA_SQL } from "./SessionStablePrefixSchema.js";

/** 拒绝历史 schema；仅全新空库允许初始化，不执行任何自动迁移。 */
export function assert_session_storage_schema(database: DatabaseSync, allow_empty = false): void {
  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (version === SESSION_STORAGE_SCHEMA_VERSION) return;
  if (allow_empty && version === 0 && !database.prepare(
    "SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1",
  ).get()) return;
  throw new Error(
    `session_schema_mismatch: Session schema version ${String(version)} does not match ${String(SESSION_STORAGE_SCHEMA_VERSION)}; `
      + "an offline migration is required before opening this Session; no automatic migration was performed",
  );
}

/** 当前 Session SQLite schema 版本。 */
export const SESSION_STORAGE_SCHEMA_VERSION = 7;

/** 创建 Session canonical 表、索引与角色约束。 */
export const SESSION_STORAGE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS session_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  session_id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  origin TEXT NOT NULL CHECK (json_valid(origin)),
  timezone TEXT NOT NULL,
  title TEXT,
  model_label TEXT,
  approval_mode TEXT CHECK (
    approval_mode IS NULL OR approval_mode IN ('ask', 'always-allow')
  ),
  system_snapshot TEXT,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  preview_text TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_model_binding (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  binding TEXT NOT NULL CHECK (json_valid(binding))
);

CREATE TABLE IF NOT EXISTS session_execution_profile (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  reference TEXT NOT NULL CHECK (json_valid(reference))
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  turn_id TEXT,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  state TEXT CHECK (
    state IS NULL OR state IN ('streaming', 'done')
  ),
  stable_part_sequence INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(stable_part_sequence) = 'integer' AND stable_part_sequence >= 0
    AND (role = 'agent' OR stable_part_sequence = 0)
  ),
  meta TEXT CHECK (meta IS NULL OR (json_valid(meta) AND json_type(meta) = 'object' AND role = 'user')),
  origin_session_id TEXT,
  origin_message_id TEXT,
  origin_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (role = 'user' AND state IS NULL) OR
    (role = 'agent' AND state IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS message_parts (
  part_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  step_id TEXT,
  type TEXT NOT NULL CHECK (
    type IN (
      'text', 'context', 'reasoning', 'tool',
      'file', 'data', 'power', 'action', 'error', 'inbox'
    )
  ),
  content TEXT NOT NULL CHECK (json_valid(content)) CHECK (
    type <> 'inbox' OR COALESCE(
      json_type(content, '$.inbox_id') = 'text' AND length(json_extract(content, '$.inbox_id')) > 0,
      0
    )
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(message_id, sequence)
);

CREATE INDEX IF NOT EXISTS messages_turn_sequence_index
ON messages(turn_id, sequence);

CREATE INDEX IF NOT EXISTS messages_streaming_agent_sequence_index
ON messages(state, sequence) WHERE role = 'agent' AND state = 'streaming';

CREATE INDEX IF NOT EXISTS message_parts_message_sequence_index
ON message_parts(message_id, sequence);

CREATE INDEX IF NOT EXISTS message_parts_step_index
ON message_parts(step_id, message_id, sequence);

CREATE INDEX IF NOT EXISTS message_parts_type_index
ON message_parts(type, message_id);

CREATE UNIQUE INDEX IF NOT EXISTS message_parts_inbox_id_index
ON message_parts(json_extract(content, '$.inbox_id')) WHERE type = 'inbox';

CREATE TRIGGER IF NOT EXISTS messages_role_immutable
BEFORE UPDATE OF role ON messages
WHEN OLD.role <> NEW.role
BEGIN
  SELECT RAISE(ABORT, 'message role is immutable');
END;

CREATE TRIGGER IF NOT EXISTS message_parts_validate_role_insert
BEFORE INSERT ON message_parts
WHEN NOT (
  (
    (SELECT role FROM messages WHERE message_id = NEW.message_id) = 'user'
    AND NEW.type IN ('text', 'context', 'file', 'data')
  ) OR
  (
    (SELECT role FROM messages WHERE message_id = NEW.message_id) = 'agent'
    AND NEW.type IN (
      'text', 'reasoning', 'tool',
      'file', 'data', 'power', 'action', 'error', 'inbox'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'message part type is incompatible with message role');
END;

CREATE TRIGGER IF NOT EXISTS message_parts_validate_role_update
BEFORE UPDATE OF message_id, type ON message_parts
WHEN NOT (
  (
    (SELECT role FROM messages WHERE message_id = NEW.message_id) = 'user'
    AND NEW.type IN ('text', 'context', 'file', 'data')
  ) OR
  (
    (SELECT role FROM messages WHERE message_id = NEW.message_id) = 'agent'
    AND NEW.type IN (
      'text', 'reasoning', 'tool',
      'file', 'data', 'power', 'action', 'error', 'inbox'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'message part type is incompatible with message role');
END;

${SESSION_STABLE_PREFIX_SCHEMA_SQL}
`;
