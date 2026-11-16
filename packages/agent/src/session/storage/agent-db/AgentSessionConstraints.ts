/**
 * Agent DB 的 Session 范围身份、角色和稳定前缀约束。
 *
 * 每个子查询都带 session_key；同 Message/Part ID 可以在不同 Session 中存在。
 * 删除 Message/Session 时的级联清理合法，单独删除或变更稳定 Part 则拒绝。
 * 领域层仍校验完整聚合和 Step 边界，SQL 约束是绕过领域写入时的最后防线。
 */
export const AGENT_SESSION_CONSTRAINTS_SQL = `
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
`;
