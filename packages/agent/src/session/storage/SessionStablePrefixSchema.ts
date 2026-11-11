/**
 * 稳定 Part 前缀的 SQLite 防线。
 *
 * 新 Message 先以水位 0 建立，再在同一事务写入 Parts 和推进水位；直接 SQL 也不能
 * 推进至缺失或未终态的 Part。删除整个 Message 的级联清理仍合法，独立删除稳定 Part
 * 则被拒绝。时间戳更新不改变 Part 内容，允许同值写入及正常收口。
 */
export const SESSION_STABLE_PREFIX_SCHEMA_SQL = `
CREATE TRIGGER IF NOT EXISTS messages_stable_prefix_insert
BEFORE INSERT ON messages
WHEN NEW.stable_part_sequence <> 0
BEGIN
  SELECT RAISE(ABORT, 'stable prefix must be committed after Parts exist');
END;

CREATE TRIGGER IF NOT EXISTS messages_stable_prefix_update
BEFORE UPDATE OF stable_part_sequence ON messages
BEGIN
  SELECT CASE WHEN NEW.stable_part_sequence < OLD.stable_part_sequence
    THEN RAISE(ABORT, 'stable Part sequence cannot move backwards') END;
  SELECT CASE WHEN NEW.stable_part_sequence <> (
    SELECT COUNT(*) FROM message_parts
    WHERE message_id = NEW.message_id AND sequence <= NEW.stable_part_sequence
  ) THEN RAISE(ABORT, 'stable prefix contains missing or out-of-range Parts') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM message_parts
    WHERE message_id = NEW.message_id AND sequence <= NEW.stable_part_sequence
      AND (
        (type IN ('text', 'reasoning') AND COALESCE(json_extract(content, '$.state'), '') <> 'done')
        OR (type IN ('tool', 'action') AND COALESCE(json_extract(content, '$.state'), '') NOT IN ('completed', 'failed'))
      )
  ) THEN RAISE(ABORT, 'stable prefix cannot include non-terminal Parts') END;
END;

CREATE TRIGGER IF NOT EXISTS message_parts_stable_prefix_insert
BEFORE INSERT ON message_parts
WHEN NEW.sequence <= (SELECT stable_part_sequence FROM messages WHERE message_id = NEW.message_id)
  OR EXISTS (
    SELECT 1 FROM message_parts JOIN messages USING (message_id)
    WHERE part_id = NEW.part_id AND message_parts.sequence <= messages.stable_part_sequence
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot insert into stable prefix');
END;

CREATE TRIGGER IF NOT EXISTS message_parts_stable_prefix_update
BEFORE UPDATE ON message_parts
WHEN (
  OLD.sequence <= (SELECT stable_part_sequence FROM messages WHERE message_id = OLD.message_id)
  OR NEW.sequence <= (SELECT stable_part_sequence FROM messages WHERE message_id = NEW.message_id)
) AND (
  OLD.part_id IS NOT NEW.part_id OR OLD.message_id IS NOT NEW.message_id
  OR OLD.sequence IS NOT NEW.sequence OR OLD.step_id IS NOT NEW.step_id
  OR OLD.type IS NOT NEW.type OR OLD.content IS NOT NEW.content
  OR OLD.created_at IS NOT NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'stable Part content is immutable');
END;

CREATE TRIGGER IF NOT EXISTS message_parts_stable_prefix_delete
BEFORE DELETE ON message_parts
WHEN OLD.sequence <= (SELECT stable_part_sequence FROM messages WHERE message_id = OLD.message_id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete stable Part');
END;
`;
