/** @file 验证 Session SQLite v2 到 v3 的一次性外部迁移。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrate_session_sqlite_v3 } from "./migrate-session-sqlite-v3.mjs";

/** 创建只包含迁移相关结构的 v2 Session 数据库。 */
async function create_v2_database(root_path) {
  const session_path = path.join(root_path, "agents", "agent-1", "sessions", "chat", "session-1");
  await fs.mkdir(session_path, { recursive: true });
  const database_path = path.join(session_path, "session.db");
  const database = new DatabaseSync(database_path);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE messages (
      message_id TEXT PRIMARY KEY, turn_id TEXT, sequence INTEGER NOT NULL UNIQUE,
      revision INTEGER NOT NULL, role TEXT NOT NULL, input_type TEXT, status TEXT,
      visibility TEXT NOT NULL, origin_session_id TEXT, origin_message_id TEXT,
      origin_turn_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE message_parts (
      part_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL, step_id TEXT, type TEXT NOT NULL,
      content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE composer_test_rows (
      message_id TEXT REFERENCES messages(message_id) ON DELETE CASCADE
    );
    CREATE TRIGGER messages_role_immutable BEFORE UPDATE OF role ON messages
    WHEN OLD.role <> NEW.role BEGIN SELECT RAISE(ABORT, 'immutable'); END;
    CREATE TRIGGER message_parts_validate_role_insert BEFORE INSERT ON message_parts
    WHEN 0 BEGIN SELECT RAISE(ABORT, 'invalid'); END;
    CREATE TRIGGER message_parts_validate_role_update BEFORE UPDATE ON message_parts
    WHEN 0 BEGIN SELECT RAISE(ABORT, 'invalid'); END;
    PRAGMA user_version = 2;
  `);
  const insert = database.prepare(`
    INSERT INTO messages VALUES (?, 'turn-1', ?, 1, ?, ?, ?, 'visible', NULL, NULL, NULL, 1, 1)
  `);
  insert.run("user-1", 1, "user", "prompt", null);
  insert.run("agent-1", 2, "agent", null, "completed");
  database.prepare("INSERT INTO message_parts VALUES ('part-1', 'user-1', 1, NULL, 'text', ?, 1, 1)")
    .run(JSON.stringify({ text: "hello", state: "done" }));
  database.prepare("INSERT INTO composer_test_rows VALUES ('user-1')").run();
  database.close();
  return database_path;
}

test("外部脚本原子收敛 Message 状态与 User Text content", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "session-sqlite-v3-"));
  const database_path = await create_v2_database(root_path);
  assert.equal((await migrate_session_sqlite_v3({ root_path, dry_run: true })).migrated_databases, 1);
  assert.equal((await migrate_session_sqlite_v3({ root_path, dry_run: false })).migrated_databases, 1);

  const database = new DatabaseSync(database_path, { readOnly: true });
  try {
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 3);
    assert.deepEqual(
      database.prepare("SELECT role, state FROM messages ORDER BY sequence").all().map((row) => ({ ...row })),
      [{ role: "user", state: null }, { role: "agent", state: "done" }],
    );
    assert.deepEqual(JSON.parse(database.prepare("SELECT content FROM message_parts").get().content), { text: "hello" });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM composer_test_rows").get().count, 1);
    assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    database.close();
  }
  assert.equal((await migrate_session_sqlite_v3({ root_path, dry_run: false })).skipped_databases, 1);
});
