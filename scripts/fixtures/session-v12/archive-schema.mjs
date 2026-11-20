/** Frozen published v12 protocol from 9a983f62a; offline conversion only. */
/**
 * Agent DB归档操作日志与不可变后序节点。
 * 与业务数据同库保存，不依赖内存或外部摘要；节点归档事实和进度可在同事务提交。
 */
export const AGENT_ARCHIVE_PLAN_SCHEMA_SQL = `
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
`;
