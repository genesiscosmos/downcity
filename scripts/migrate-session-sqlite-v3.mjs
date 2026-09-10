/**
 * @file 将现有 Session SQLite v1/v2 一次性迁移为 v3。
 *
 * Runtime 与 Desktop 不导入本文件。脚本删除 User `input_type` 与 Agent 四态
 * `status`，统一写入最小的 Agent `state = streaming | done`，并移除 User Text
 * content 中历史遗留的 `state` 字段。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const TARGET_SCHEMA_VERSION = 3;

/** 解析一次性迁移脚本参数。 */
export function parse_arguments(arguments_) {
  const input = {
    root_path: path.join(os.homedir(), ".downcity"),
    dry_run: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") input.dry_run = true;
    else if (argument === "--root" && arguments_[index + 1]) {
      input.root_path = arguments_[++index];
    } else {
      throw new Error(`未知参数：${String(argument)}`);
    }
  }
  return input;
}

/** 扫描指定 Downcity 数据根并迁移全部 Session 数据库。 */
export async function migrate_session_sqlite_v3(input) {
  const database_paths = await find_session_databases(
    path.join(path.resolve(input.root_path), "agents"),
  );
  const result = {
    scanned_databases: database_paths.length,
    migrated_databases: 0,
    skipped_databases: 0,
    dry_run: Boolean(input.dry_run),
    databases: [],
  };
  for (const database_path of database_paths) {
    const migration = migrate_database(database_path, Boolean(input.dry_run));
    result.databases.push(migration);
    if (migration.status === "migrated") result.migrated_databases += 1;
    else result.skipped_databases += 1;
  }
  return result;
}

/** 递归查找 Agent 私有目录下名为 session.db 的文件。 */
async function find_session_databases(directory_path) {
  const entries = await fs.readdir(directory_path, { withFileTypes: true })
    .catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  const output = [];
  for (const entry of entries) {
    const entry_path = path.join(directory_path, entry.name);
    if (entry.isDirectory()) output.push(...await find_session_databases(entry_path));
    else if (entry.isFile() && entry.name === "session.db") output.push(entry_path);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

/** 在单个事务内把 messages 表和 User Text content 升级到 v3。 */
function migrate_database(database_path, dry_run) {
  const database = new DatabaseSync(database_path);
  try {
    const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version === TARGET_SCHEMA_VERSION) {
      return { database_path, from_version: version, status: "skipped" };
    }
    if (version !== 1 && version !== 2) {
      throw new Error(`不支持的 Session schema 版本 ${String(version)}：${database_path}`);
    }
    if (dry_run) return { database_path, from_version: version, status: "migrated" };

    database.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      database.exec(`
        DROP TRIGGER IF EXISTS messages_role_immutable;
        DROP TRIGGER IF EXISTS message_parts_validate_role_insert;
        DROP TRIGGER IF EXISTS message_parts_validate_role_update;

        CREATE TABLE messages_v3 (
          message_id TEXT PRIMARY KEY,
          turn_id TEXT,
          sequence INTEGER NOT NULL UNIQUE CHECK (sequence >= 1),
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
          role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
          state TEXT CHECK (state IS NULL OR state IN ('streaming', 'done')),
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

        INSERT INTO messages_v3 (
          message_id, turn_id, sequence, revision, role, state, visibility,
          origin_session_id, origin_message_id, origin_turn_id, created_at, updated_at
        )
        SELECT
          message_id, turn_id, sequence, revision, role,
          CASE WHEN role = 'agent' AND status = 'streaming' THEN 'streaming'
               WHEN role = 'agent' THEN 'done' ELSE NULL END,
          visibility, origin_session_id, origin_message_id, origin_turn_id,
          created_at, updated_at
        FROM messages;

        DROP TABLE messages;
        ALTER TABLE messages_v3 RENAME TO messages;

        CREATE INDEX messages_turn_sequence_index ON messages(turn_id, sequence);
        CREATE INDEX messages_visibility_sequence_index ON messages(visibility, sequence);

        CREATE TRIGGER messages_role_immutable
        BEFORE UPDATE OF role ON messages
        WHEN OLD.role <> NEW.role
        BEGIN SELECT RAISE(ABORT, 'message role is immutable'); END;

        CREATE TRIGGER message_parts_validate_role_insert
        BEFORE INSERT ON message_parts
        WHEN NOT (
          ((SELECT role FROM messages WHERE message_id = NEW.message_id) = 'user'
            AND NEW.type IN ('text', 'context', 'file', 'data')) OR
          ((SELECT role FROM messages WHERE message_id = NEW.message_id) = 'agent'
            AND NEW.type IN ('text', 'reasoning', 'tool', 'interaction', 'file', 'data', 'action', 'error'))
        )
        BEGIN SELECT RAISE(ABORT, 'message part type is incompatible with message role'); END;

        CREATE TRIGGER message_parts_validate_role_update
        BEFORE UPDATE OF message_id, type ON message_parts
        WHEN NOT (
          ((SELECT role FROM messages WHERE message_id = NEW.message_id) = 'user'
            AND NEW.type IN ('text', 'context', 'file', 'data')) OR
          ((SELECT role FROM messages WHERE message_id = NEW.message_id) = 'agent'
            AND NEW.type IN ('text', 'reasoning', 'tool', 'interaction', 'file', 'data', 'action', 'error'))
        )
        BEGIN SELECT RAISE(ABORT, 'message part type is incompatible with message role'); END;
      `);
      migrate_user_text_content(database);
      database.exec("PRAGMA user_version = 3;");
      const foreign_key_errors = database.prepare("PRAGMA foreign_key_check").all();
      const integrity = database.prepare("PRAGMA integrity_check").get();
      if (foreign_key_errors.length > 0 || integrity?.integrity_check !== "ok") {
        throw new Error(`Session SQLite v3 校验失败：${database_path}`);
      }
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
    return { database_path, from_version: version, status: "migrated" };
  } finally {
    database.close();
  }
}

/** 删除 User Text Part 中已经失去语义的固定 `state: done`。 */
function migrate_user_text_content(database) {
  const rows = database.prepare(`
    SELECT message_parts.part_id, message_parts.content
    FROM message_parts
    JOIN messages ON messages.message_id = message_parts.message_id
    WHERE messages.role = 'user' AND message_parts.type = 'text'
  `).all();
  const update = database.prepare("UPDATE message_parts SET content = ? WHERE part_id = ?");
  for (const row of rows) {
    const content = JSON.parse(row.content);
    delete content.state;
    update.run(JSON.stringify(content), row.part_id);
  }
}

const current_file_path = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === current_file_path) {
  console.log(JSON.stringify(await migrate_session_sqlite_v3(
    parse_arguments(process.argv.slice(2)),
  ), null, 2));
}
