-- Frozen published v12 DDL; offline conversion only.

CREATE TABLE storage_metadata (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  agent_id TEXT NOT NULL CHECK (length(trim(agent_id)) > 0),
  format_version INTEGER NOT NULL CHECK (format_version = 12),
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

CREATE TABLE agent_session_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  main_session_id TEXT REFERENCES sessions(session_id) ON DELETE SET NULL
) STRICT;
INSERT INTO agent_session_state(singleton_id) VALUES (1);

-- 已删除身份继续占用；业务创建和单记录导入均不能复活旧会话。
CREATE TABLE retired_session_ids (
  session_id TEXT PRIMARY KEY,
  retired_at INTEGER NOT NULL
) STRICT;

-- 业务创建键独立于永久 UUID；记录删除后保留映射，不能复活旧身份。
CREATE TABLE session_creation_keys (
  category TEXT NOT NULL,
  creation_key TEXT NOT NULL CHECK (length(creation_key) BETWEEN 1 AND 512),
  session_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (category, creation_key)
) STRICT;

-- 离线转换的旧操作仅供审计，绝不当作新协议下的幂等证明。
CREATE TABLE legacy_operation_ids (
  operation_id TEXT PRIMARY KEY,
  source_schema INTEGER NOT NULL,
  audit_sha256 TEXT NOT NULL CHECK (length(audit_sha256) = 64)
) STRICT;
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


CREATE TRIGGER sessions_identity_immutable
BEFORE UPDATE OF session_key, session_id, category, origin, created_at ON sessions
WHEN OLD.session_key IS NOT NEW.session_key
  OR OLD.session_id IS NOT NEW.session_id OR OLD.category IS NOT NEW.category
  OR OLD.origin IS NOT NEW.origin OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'session identity is immutable');
END;

CREATE TRIGGER sessions_configuration_insert AFTER INSERT ON sessions
BEGIN
  INSERT INTO session_configuration(session_key) VALUES (NEW.session_key);
END;

CREATE TRIGGER sessions_attachment_cleanup AFTER DELETE ON sessions
BEGIN
  INSERT INTO attachment_cleanup(session_id, requested_at) VALUES (OLD.session_id, unixepoch('subsec') * 1000)
  ON CONFLICT(session_id) DO NOTHING;
  INSERT INTO retired_session_ids(session_id, retired_at) VALUES (OLD.session_id, unixepoch('subsec') * 1000);
END;

CREATE TRIGGER sessions_retired_identity BEFORE INSERT ON sessions
WHEN EXISTS (SELECT 1 FROM retired_session_ids WHERE session_id = NEW.session_id)
BEGIN
  SELECT RAISE(ABORT, 'session identity is retired');
END;

CREATE TRIGGER sessions_main_archive AFTER UPDATE OF archived ON sessions
WHEN NEW.archived = 1
BEGIN
  UPDATE agent_session_state SET main_session_id = NULL WHERE main_session_id = OLD.session_id;
END;

CREATE TRIGGER agent_session_state_valid_insert BEFORE INSERT ON agent_session_state
WHEN NEW.main_session_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sessions WHERE session_id = NEW.main_session_id AND archived = 0
    AND category = 'chat' AND json_extract(origin, '$.type') = 'agent'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid main Session pointer');
END;

CREATE TRIGGER agent_session_state_valid_update BEFORE UPDATE OF main_session_id ON agent_session_state
WHEN NEW.main_session_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sessions WHERE session_id = NEW.main_session_id AND archived = 0
    AND category = 'chat' AND json_extract(origin, '$.type') = 'agent'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid main Session pointer');
END;

CREATE TRIGGER agent_session_state_delete_forbidden BEFORE DELETE ON agent_session_state
BEGIN
  SELECT RAISE(ABORT, 'main Session state cannot be deleted');
END;

CREATE TRIGGER retired_session_ids_update_forbidden BEFORE UPDATE ON retired_session_ids
BEGIN SELECT RAISE(ABORT, 'retired Session identity is immutable'); END;
CREATE TRIGGER retired_session_ids_delete_forbidden BEFORE DELETE ON retired_session_ids
BEGIN
  SELECT RAISE(ABORT, 'retired Session identity cannot be deleted');
END;

CREATE TRIGGER session_creation_keys_update_forbidden BEFORE UPDATE ON session_creation_keys
BEGIN SELECT RAISE(ABORT, 'Session creation key is immutable'); END;
CREATE TRIGGER session_creation_keys_delete_forbidden BEFORE DELETE ON session_creation_keys
BEGIN SELECT RAISE(ABORT, 'Session creation key cannot be deleted'); END;

CREATE TRIGGER messages_identity_immutable
BEFORE UPDATE ON messages
WHEN OLD.session_key IS NOT NEW.session_key OR OLD.message_id IS NOT NEW.message_id
  OR OLD.sequence IS NOT NEW.sequence OR OLD.role IS NOT NEW.role
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.origin_session_id IS NOT NEW.origin_session_id OR OLD.origin_message_id IS NOT NEW.origin_message_id
  OR OLD.origin_turn_id IS NOT NEW.origin_turn_id
BEGIN
  SELECT RAISE(ABORT, 'message identity is immutable');
END;

CREATE TRIGGER message_parts_validate_role_insert BEFORE INSERT ON message_parts
WHEN NOT EXISTS (
  SELECT 1 FROM messages WHERE session_key = NEW.session_key AND message_id = NEW.message_id
    AND ((role = 'user' AND NEW.type IN ('text', 'context', 'file', 'data'))
      OR (role = 'agent' AND NEW.type <> 'context'))
)
BEGIN
  SELECT RAISE(ABORT, 'message part type is incompatible with message role');
END;

CREATE TRIGGER message_parts_identity_immutable BEFORE UPDATE ON message_parts
WHEN OLD.session_key IS NOT NEW.session_key OR OLD.part_id IS NOT NEW.part_id
  OR OLD.message_id IS NOT NEW.message_id OR OLD.sequence IS NOT NEW.sequence
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'message part identity is immutable');
END;

CREATE TRIGGER message_parts_validate_role_update BEFORE UPDATE OF type ON message_parts
WHEN NOT EXISTS (
  SELECT 1 FROM messages WHERE session_key = NEW.session_key AND message_id = NEW.message_id
    AND ((role = 'user' AND NEW.type IN ('text', 'context', 'file', 'data'))
      OR (role = 'agent' AND NEW.type <> 'context'))
)
BEGIN
  SELECT RAISE(ABORT, 'message part type is incompatible with message role');
END;

CREATE TRIGGER messages_stable_prefix_insert BEFORE INSERT ON messages
WHEN NEW.stable_part_sequence <> 0
BEGIN
  SELECT RAISE(ABORT, 'stable prefix must be committed after Parts exist');
END;

CREATE TRIGGER messages_stable_prefix_update BEFORE UPDATE OF stable_part_sequence ON messages
BEGIN
  SELECT CASE WHEN NEW.stable_part_sequence < OLD.stable_part_sequence
    THEN RAISE(ABORT, 'stable Part sequence cannot move backwards') END;
  SELECT CASE WHEN NEW.stable_part_sequence <> (
    SELECT COUNT(*) FROM message_parts WHERE session_key = NEW.session_key
      AND message_id = NEW.message_id AND sequence <= NEW.stable_part_sequence
  ) THEN RAISE(ABORT, 'stable prefix contains missing or out-of-range Parts') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM message_parts WHERE session_key = NEW.session_key AND message_id = NEW.message_id
      AND sequence <= NEW.stable_part_sequence AND (
        (type IN ('text', 'reasoning') AND COALESCE(json_extract(content, '$.state'), '') <> 'done')
        OR (type IN ('tool', 'action') AND COALESCE(json_extract(content, '$.state'), '') NOT IN ('completed', 'failed'))
      )
  ) THEN RAISE(ABORT, 'stable prefix cannot include non-terminal Parts') END;
END;

CREATE TRIGGER message_parts_stable_prefix_insert BEFORE INSERT ON message_parts
WHEN NEW.sequence <= (
  SELECT stable_part_sequence FROM messages WHERE session_key = NEW.session_key AND message_id = NEW.message_id
) OR EXISTS (
  SELECT 1 FROM message_parts AS part JOIN messages AS message
    ON message.session_key = part.session_key AND message.message_id = part.message_id
  WHERE part.session_key = NEW.session_key AND part.part_id = NEW.part_id
    AND part.sequence <= message.stable_part_sequence
)
BEGIN
  SELECT RAISE(ABORT, 'cannot insert into stable prefix');
END;

CREATE TRIGGER message_parts_stable_prefix_update BEFORE UPDATE ON message_parts
WHEN OLD.sequence <= (
  SELECT stable_part_sequence FROM messages WHERE session_key = OLD.session_key AND message_id = OLD.message_id
) AND (OLD.step_id IS NOT NEW.step_id OR OLD.type IS NOT NEW.type OR OLD.content IS NOT NEW.content)
BEGIN
  SELECT RAISE(ABORT, 'stable Part content is immutable');
END;

CREATE TRIGGER message_parts_stable_prefix_delete BEFORE DELETE ON message_parts
WHEN OLD.sequence <= (
  SELECT stable_part_sequence FROM messages WHERE session_key = OLD.session_key AND message_id = OLD.message_id
)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete stable Part');
END;

CREATE TRIGGER composer_checkpoint_validate_insert BEFORE INSERT ON composer_checkpoints
WHEN NOT EXISTS (
  SELECT 1 FROM messages WHERE session_key = NEW.session_key AND message_id = NEW.through_message_id
    AND sequence = NEW.through_message_sequence
    AND ((role = 'agent' AND stable_part_sequence >= NEW.through_part_sequence)
      OR (role = 'user' AND EXISTS (SELECT 1 FROM message_parts
        WHERE session_key = NEW.session_key AND message_id = NEW.through_message_id
          AND sequence = NEW.through_part_sequence)))
)
BEGIN
  SELECT RAISE(ABORT, 'checkpoint requires its Session stable Part boundary');
END;

CREATE TRIGGER composer_checkpoint_immutable BEFORE UPDATE ON composer_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'checkpoint is immutable');
END;


CREATE TABLE archive_operations (
  operation_id TEXT PRIMARY KEY CHECK (length(operation_id) = 36),
  root_session_id TEXT NOT NULL CHECK (length(root_session_id) = 36),
  category TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;
CREATE TABLE archive_operation_nodes (
  operation_id TEXT NOT NULL REFERENCES archive_operations(operation_id),
  position INTEGER NOT NULL CHECK (position >= 1),
  session_id TEXT NOT NULL CHECK (length(session_id) = 36),
  category TEXT NOT NULL,
  origin_type TEXT NOT NULL,
  workspace_id TEXT,
  committed_at INTEGER,
  PRIMARY KEY (operation_id, position),
  UNIQUE (operation_id, session_id)
) STRICT;
CREATE INDEX archive_pending_node ON archive_operation_nodes(session_id) WHERE committed_at IS NULL;
CREATE TRIGGER archive_operation_identity_immutable BEFORE UPDATE ON archive_operations
WHEN OLD.operation_id IS NOT NEW.operation_id OR OLD.root_session_id IS NOT NEW.root_session_id
  OR OLD.category IS NOT NEW.category
  OR OLD.fingerprint IS NOT NEW.fingerprint OR OLD.created_at IS NOT NEW.created_at
  OR (OLD.completed_at IS NOT NULL AND OLD.completed_at IS NOT NEW.completed_at)
BEGIN SELECT RAISE(ABORT, 'archive operation identity is immutable'); END;
CREATE TRIGGER archive_node_identity_immutable BEFORE UPDATE ON archive_operation_nodes
WHEN OLD.operation_id IS NOT NEW.operation_id OR OLD.position IS NOT NEW.position
  OR OLD.session_id IS NOT NEW.session_id
  OR OLD.category IS NOT NEW.category OR OLD.origin_type IS NOT NEW.origin_type
  OR OLD.workspace_id IS NOT NEW.workspace_id
  OR (OLD.committed_at IS NOT NULL AND OLD.committed_at IS NOT NEW.committed_at)
BEGIN SELECT RAISE(ABORT, 'archive node identity is immutable'); END;
CREATE TRIGGER archive_node_delete_forbidden BEFORE DELETE ON archive_operation_nodes
BEGIN SELECT RAISE(ABORT, 'archive plan cannot be deleted'); END;
CREATE TRIGGER archive_operation_delete_forbidden BEFORE DELETE ON archive_operations
BEGIN SELECT RAISE(ABORT, 'archive operation cannot be deleted'); END;
CREATE TRIGGER sessions_pending_archive_child BEFORE INSERT ON sessions
WHEN json_extract(NEW.origin, '$.parent_agent_id') = (SELECT agent_id FROM storage_metadata WHERE singleton_id = 1)
  AND EXISTS (SELECT 1 FROM archive_operation_nodes AS node
  WHERE node.committed_at IS NULL AND node.session_id = json_extract(NEW.origin, '$.parent_session_id')
    AND node.category = json_extract(NEW.origin, '$.parent_session_category'))
BEGIN SELECT RAISE(ABORT, 'cannot add descendants to a pending archive plan'); END;
CREATE TRIGGER messages_partial_archive_insert BEFORE INSERT ON messages
WHEN EXISTS (SELECT 1 FROM archive_operation_nodes AS node JOIN sessions USING(session_id)
  WHERE sessions.session_key = NEW.session_key AND node.committed_at IS NULL
    AND EXISTS (SELECT 1 FROM archive_operation_nodes AS prior WHERE prior.operation_id = node.operation_id AND prior.committed_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'resume pending archive before executing Session'); END;
CREATE TRIGGER sessions_pending_archive_delete BEFORE DELETE ON sessions
WHEN EXISTS (SELECT 1 FROM archive_operation_nodes WHERE session_id = OLD.session_id AND committed_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'session is reserved by an archive plan'); END;
