/**
 * Session SQLite 核心 schema。
 *
 * 这里只定义所有 Composer 共享的 canonical 表和持久化约束；任何摘要、索引或
 * 检索表都由具体 Composer 在自己的 namespace 中创建。
 */

/** 当前 Session SQLite schema 版本。 */
export const SESSION_STORAGE_SCHEMA_VERSION = 3;

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

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  turn_id TEXT,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  state TEXT CHECK (
    state IS NULL OR state IN ('streaming', 'done')
  ),
  visibility TEXT NOT NULL CHECK (visibility IN ('visible', 'internal')),
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
      'text', 'context', 'reasoning', 'tool', 'interaction',
      'file', 'data', 'action', 'error'
    )
  ),
  content TEXT NOT NULL CHECK (json_valid(content)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(message_id, sequence)
);

CREATE INDEX IF NOT EXISTS messages_turn_sequence_index
ON messages(turn_id, sequence);

CREATE INDEX IF NOT EXISTS messages_visibility_sequence_index
ON messages(visibility, sequence);

CREATE INDEX IF NOT EXISTS message_parts_message_sequence_index
ON message_parts(message_id, sequence);

CREATE INDEX IF NOT EXISTS message_parts_step_index
ON message_parts(step_id, message_id, sequence);

CREATE INDEX IF NOT EXISTS message_parts_type_index
ON message_parts(type, message_id);

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
      'text', 'reasoning', 'tool', 'interaction',
      'file', 'data', 'action', 'error'
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
      'text', 'reasoning', 'tool', 'interaction',
      'file', 'data', 'action', 'error'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'message part type is incompatible with message role');
END;
`;
