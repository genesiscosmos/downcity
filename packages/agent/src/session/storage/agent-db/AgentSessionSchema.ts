/**
 * Agent 范围 Session 数据库的正式 v14 schema。
 *
 * sessions 是目录唯一事实源；canonical、配置和 Composer 数据通过内部 session_key
 * 关联。session_id 是永久 UUID，归档不会改变身份；宿主状态保存在通用变量中。
 * 存储拥有者、宿主门禁与离线工具共用本模块的版本规则，不自动升级历史数据库。
 */
import type { DatabaseSync } from "node:sqlite";
import { AGENT_ARCHIVE_PLAN_SCHEMA_SQL } from "./AgentArchivePlanSchema.js";
import { AGENT_SESSION_CONSTRAINTS_SQL } from "./AgentSessionConstraints.js";

/** 与每 Session v7 分库明确区分的 Agent DB 格式。 */
export const AGENT_SESSION_SCHEMA_VERSION = 14;

/** 校验版本、目录结构和数据库拥有者；只读调用绝不初始化数据库。 */
export function assert_agent_session_schema(database: DatabaseSync, agent_id: string): void {
  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (version !== AGENT_SESSION_SCHEMA_VERSION) {
    const database_path = database.prepare("PRAGMA database_list").all().find(row => row.name === "main")?.file || ":memory:";
    throw new Error(`session_migration_required: Agent Session storage requires offline migration; agent_id=${agent_id}; database_path=${database_path}; actual_version=${version}; expected_version=${AGENT_SESSION_SCHEMA_VERSION}`);
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
  format_version INTEGER NOT NULL CHECK (format_version = 14),
  generation TEXT NOT NULL CHECK (length(generation) = 36),
  cursor_secret BLOB NOT NULL CHECK (length(cursor_secret) = 32),
  created_at INTEGER NOT NULL,
  first_business_write_at INTEGER
) STRICT;

CREATE TABLE sessions (
  session_key INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE CHECK (
    length(session_id) = 36 AND session_id = lower(session_id)
    AND substr(session_id, 9, 1) = '-' AND substr(session_id, 14, 1) = '-'
    AND substr(session_id, 19, 1) = '-' AND substr(session_id, 24, 1) = '-'
    AND substr(session_id, 15, 1) = '4' AND substr(session_id, 20, 1) IN ('8', '9', 'a', 'b')
    AND length(replace(session_id, '-', '')) = 32
    AND replace(session_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  type TEXT NOT NULL CHECK (type IN ('chat', 'work')),
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0 AND kind = trim(kind)),
  relations TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(relations) AND json_type(relations) = 'object'
    AND json_type(relations, '$.type') IS NULL AND json_type(relations, '$.kind') IS NULL),
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

CREATE TABLE agent_variables (
  key TEXT PRIMARY KEY CHECK (length(trim(key)) > 0),
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;

-- 已删除身份继续占用；业务创建和单记录导入均不能复活旧会话。
CREATE TABLE retired_session_ids (
  session_id TEXT PRIMARY KEY,
  retired_at INTEGER NOT NULL
) STRICT;

-- 业务创建键独立于永久 UUID；记录删除后保留映射，不能复活旧身份。
CREATE TABLE session_creation_keys (
  type TEXT NOT NULL,
  creation_key TEXT NOT NULL CHECK (length(creation_key) BETWEEN 1 AND 512),
  session_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (type, creation_key)
) STRICT;

-- 离线转换的旧操作仅供审计，绝不当作新协议下的幂等证明。
CREATE TABLE legacy_operation_ids (
  operation_id TEXT PRIMARY KEY,
  source_schema INTEGER NOT NULL,
  audit_sha256 TEXT NOT NULL CHECK (length(audit_sha256) = 64)
) STRICT;
CREATE INDEX sessions_type_list ON sessions(type, archived, updated_at DESC, session_key DESC);
CREATE INDEX sessions_agent_list ON sessions(type, kind, archived, updated_at DESC, session_key DESC);
CREATE INDEX sessions_workspace_list ON sessions(workspace_id, type, kind, archived, updated_at DESC, session_key DESC);

CREATE TABLE session_configuration (
  session_key INTEGER PRIMARY KEY REFERENCES sessions(session_key) ON DELETE CASCADE,
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
  meta TEXT CHECK (meta IS NULL OR (json_valid(meta) AND json_type(meta) = 'object')),
  origin_session_id TEXT,
  origin_message_id TEXT,
  origin_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_key, message_id),
  UNIQUE (session_key, sequence),
  CHECK ((role = 'user' AND state IS NULL) OR (role = 'agent' AND state IS NOT NULL)),
  CHECK (origin_session_id IS NULL OR length(origin_session_id) = 36)
) STRICT;

CREATE TABLE message_parts (
  session_key INTEGER NOT NULL,
  part_id TEXT NOT NULL CHECK (length(part_id) > 0),
  message_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  step_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('text', 'context', 'reasoning', 'tool', 'file', 'data', 'view', 'action', 'error', 'input')),
  content TEXT NOT NULL CHECK (json_valid(content)) CHECK (
    type <> 'input' OR COALESCE(json_type(content, '$.input_id') = 'text'
      AND length(json_extract(content, '$.input_id')) > 0, 0)
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
CREATE UNIQUE INDEX message_parts_input ON message_parts(session_key, json_extract(content, '$.input_id')) WHERE type = 'input';

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
  session_id TEXT,
  result TEXT NOT NULL CHECK (json_valid(result)),
  committed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE attachment_cleanup (
  session_id TEXT PRIMARY KEY CHECK (length(session_id) = 36),
  requested_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
) STRICT;

${AGENT_SESSION_CONSTRAINTS_SQL}
${AGENT_ARCHIVE_PLAN_SCHEMA_SQL}
`;
