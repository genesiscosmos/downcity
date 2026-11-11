/** SQLite 历史读取连接；离线稳定快照使用 immutable URI，避免创建 WAL/SHM。 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assert_session_storage_schema } from "./SessionStorageSchema.js";

/** 只读打开现有数据库；immutable 只允许在调用方持有排他协调的共享读取租约时使用。 */
export function open_session_read_database(database_path: string, immutable = false): DatabaseSync {
  if (immutable) {
    for (const suffix of ["-wal", "-journal"]) {
      const sidecar = `${database_path}${suffix}`;
      try {
        if (fs.statSync(sidecar).size > 0) throw new Error("session_recovery_required: Start a supported City host explicitly to recover pending database writes");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
  }
  const database = new DatabaseSync(immutable ? `${pathToFileURL(database_path).href}?immutable=1` : database_path, { readOnly: true });
  try {
    assert_session_storage_schema(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
