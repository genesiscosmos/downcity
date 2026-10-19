/** Session v3 → v4 的原子迁移：扩展 Part 类型，保留所有身份、顺序和内容。 */
import type { DatabaseSync } from "node:sqlite";
import { SESSION_STORAGE_SCHEMA_SQL } from "./SessionStorageSchema.js";

/** 仅升级已支持的 v3；更早版本仍遵循原有外部迁移要求。 */
export function migrate_session_storage(database: DatabaseSync, version: number): void {
  if (version !== 3) return;
  // message_parts 没有子表引用；事务内重建约束并恢复现有索引和角色触发器。
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DROP TRIGGER IF EXISTS message_parts_validate_role_insert;
      DROP TRIGGER IF EXISTS message_parts_validate_role_update;
      CREATE TABLE message_parts_v4 (
        part_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        step_id TEXT,
        type TEXT NOT NULL CHECK (type IN (
          'text', 'context', 'reasoning', 'tool', 'interaction',
          'file', 'data', 'power', 'action', 'error'
        )),
        content TEXT NOT NULL CHECK (json_valid(content)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(message_id, sequence)
      );
      INSERT INTO message_parts_v4 SELECT * FROM message_parts;
      DROP TABLE message_parts;
      ALTER TABLE message_parts_v4 RENAME TO message_parts;
    `);
    database.exec(SESSION_STORAGE_SCHEMA_SQL);
    database.exec("PRAGMA user_version = 4; COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
