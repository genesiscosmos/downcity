/**
 * Agent 范围 Session 数据库的正式 v8 schema。
 *
 * sessions 是目录唯一事实源；canonical、配置和 Composer 数据全部通过内部 session_key
 * 关联。storage_id 是可导出的不可变身份，归档只改变状态，允许同逻辑地址重新创建。
 * 本模块仅供存储拥有者和离线工具使用，不自动升级历史数据库。
 */
import type { DatabaseSync } from "node:sqlite";
import { AGENT_ARCHIVE_PLAN_SCHEMA_SQL } from "./AgentArchivePlanSchema.js";
import { AGENT_SESSION_CONSTRAINTS_SQL } from "./AgentSessionConstraints.js";

/** 与每 Session v7 分库明确区分的 Agent DB 格式。 */
export const AGENT_SESSION_SCHEMA_VERSION = 8;

/** 校验版本和数据库拥有者；只读调用绝不初始化数据库。 */
export function assert_agent_session_schema(database: DatabaseSync, agent_id: string): void {
  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (version !== AGENT_SESSION_SCHEMA_VERSION) {
    throw new Error("session_migration_required: Agent Session storage requires offline migration");
  }
  const metadata = database.prepare("SELECT agent_id, format_version FROM storage_metadata WHERE singleton_id = 1").get();
  if (metadata?.agent_id !== agent_id || metadata.format_version !== AGENT_SESSION_SCHEMA_VERSION) {
    throw new Error("session_storage_identity_conflict: Agent database identity does not match");
  }
}

/** 正式关系结构；创建与元数据写入由拥有者放在同一事务内完成。 */
export const AGENT_SESSION_SCHEMA_SQL = `
CREATE TABLE storage_metadata (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  agent_id TEXT NOT NULL CHECK (length(trim(agent_id)) > 0),
  format_version INTEGER NOT NULL CHECK (format_version = 8),
  generation TEXT NOT NULL CHECK (length(generation) = 36),
  cursor_secret BLOB NOT NULL CHECK (length(cursor_secret) = 32),
  created_at INTEGER NOT NULL,
  first_business_write_at INTEGER
) STRICT;

CREATE TABLE sessions (
  session_key INTEGER PRIMARY KEY,
  storage_id TEXT NOT NULL UNIQUE CHECK (length(storage_id) = 36),
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
  category TEXT NOT NULL CHECK (length(trim(category)) > 0),
  origin TEXT NOT NULL CHECK (
    json_valid(origin) AND json_type(origin) = 'object'
    AND COALESCE(json_type(origin, '$.category') = 'text', 0)
    AND COALESCE(json_extract(origin, '$.category') = category, 0)
    AND COALESCE(json_type(origin, '$.type') = 'text', 0)
    AND COALESCE(length(trim(json_extract(origin, '$.type'))) > 0, 0)
  ),
  workspace_id TEXT CHECK (workspace_id IS NULL OR length(trim(workspace_id)) > 0),
  timezone TEXT NOT NULL,
  title TEXT,
  model_label TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  archived_at INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  preview_text TEXT CHECK (preview_text IS NULL OR length(preview_text) <= 180),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((archived = 0 AND archived_at IS NULL) OR (archived = 1 AND archived_at IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX sessions_active_address ON sessions(category, session_id) WHERE archived = 0;
CREATE INDEX sessions_agent_list ON sessions(category, archived, updated_at DESC, session_key DESC);
CREATE INDEX sessions_workspace_list ON sessions(workspace_id, category, archived, updated_at DESC, session_key DESC);

CREATE TABLE session_configuration (
  session_key INTEGER PRIMARY KEY REFERENCES sessions(session_key) ON DELETE CASCADE,
  model_binding TEXT CHECK (model_binding IS NULL OR (json_valid(model_binding) AND json_type(model_binding) = 'object')),
  approval_mode TEXT CHECK (approval_mode IS NULL OR approval_mode IN ('ask', 'always-allow')),
  execution_profile TEXT CHECK (execution_profile IS NULL OR (json_valid(execution_profile) AND json_type(execution_profile) = 'object')),
  system_snapshot TEXT
) STRICT;

CREATE TABLE messages (
  session_key INTEGER NOT NULL REFERENCES sessions(session_key) ON DELETE CASCADE,
  message_id TEXT NOT NULL CHECK (length(message_id) > 0),
  turn_id TEXT,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  state TEXT CHECK (state IS NULL OR state IN ('streaming', 'done')),
  stable_part_sequence INTEGER NOT NULL DEFAULT 0 CHECK (
    stable_part_sequence >= 0 AND (role = 'agent' OR stable_part_sequence = 0)
  ),
  meta TEXT CHECK (meta IS NULL OR (json_valid(meta) AND json_type(meta) = 'object' AND role = 'user')),
  origin_storage_id TEXT,
  origin_session_id TEXT,
  origin_message_id TEXT,
  origin_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_key, message_id),
  UNIQUE (session_key, sequence),
  CHECK ((role = 'user' AND state IS NULL) OR (role = 'agent' AND state IS NOT NULL)),
  CHECK (origin_storage_id IS NULL OR (length(origin_storage_id) = 36 AND origin_session_id IS NOT NULL))
) STRICT;

CREATE TABLE message_parts (
  session_key INTEGER NOT NULL,
  part_id TEXT NOT NULL CHECK (length(part_id) > 0),
  message_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  step_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('text', 'context', 'reasoning', 'tool', 'file', 'data', 'power', 'action', 'error', 'inbox')),
  content TEXT NOT NULL CHECK (json_valid(content)) CHECK (
    type <> 'inbox' OR COALESCE(json_type(content, '$.inbox_id') = 'text'
      AND length(json_extract(content, '$.inbox_id')) > 0, 0)
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_key, part_id),
  UNIQUE (session_key, message_id, sequence),
  FOREIGN KEY (session_key, message_id) REFERENCES messages(session_key, message_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX messages_turn_sequence ON messages(session_key, turn_id, sequence);
CREATE INDEX messages_recoverable ON messages(session_key, state, sequence) WHERE role = 'agent' AND state = 'streaming';
CREATE INDEX message_parts_step ON message_parts(session_key, step_id, message_id, sequence);
CREATE INDEX message_parts_type ON message_parts(session_key, type, message_id);
CREATE UNIQUE INDEX message_parts_inbox ON message_parts(session_key, json_extract(content, '$.inbox_id')) WHERE type = 'inbox';

CREATE TABLE composer_checkpoints (
  session_key INTEGER NOT NULL,
  namespace TEXT NOT NULL CHECK (length(namespace) > 0),
  checkpoint_id TEXT NOT NULL,
  through_message_id TEXT NOT NULL,
  through_message_sequence INTEGER NOT NULL,
  through_part_sequence INTEGER NOT NULL CHECK (through_part_sequence >= 1),
  summary TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_key, namespace, checkpoint_id),
  UNIQUE (session_key, namespace, through_message_sequence, through_part_sequence, schema_version),
  FOREIGN KEY (session_key, through_message_id) REFERENCES messages(session_key, message_id) ON DELETE CASCADE,
  FOREIGN KEY (session_key, through_message_sequence) REFERENCES messages(session_key, sequence) ON DELETE CASCADE
) STRICT;

CREATE TABLE operation_receipts (
  operation_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  storage_id TEXT,
  result TEXT NOT NULL CHECK (json_valid(result)),
  committed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE attachment_cleanup (
  storage_id TEXT PRIMARY KEY CHECK (length(storage_id) = 36),
  requested_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
) STRICT;

${AGENT_SESSION_CONSTRAINTS_SQL}
${AGENT_ARCHIVE_PLAN_SCHEMA_SQL}
`;
