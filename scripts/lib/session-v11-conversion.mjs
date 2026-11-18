/**
 * Agent Session v10→v11 的无损离线副本转换。
 * 只重建 messages.meta 与 storage_metadata 的约束；所有业务行逐字段保留。
 * 源使用 SQLite 只读一致性事务，目标接受完整 DDL、codec、外键和逻辑摘要校验。
 */
import fs from "node:fs";
import { createHash as create_hash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { digest, fail, quote_identifier } from "./session-v7-database.mjs";
import { exists } from "./session-v8-files.mjs";
import { open_source, database_fingerprint, schema_descriptor, validate_v9 } from "./session-v9-database.mjs";
import { assert_protocol_database } from "./session-v10-proof.mjs";

/** 按主键流式核验全部表；唯一允许变化的业务字段是存储格式版本。 */
export function content_digest(database) {
  const hash = create_hash("sha256");
  for (const item of schema_descriptor(database).filter(row => row.type === "table")) {
    const table = quote_identifier(item.name);
    const keys = database.prepare(`PRAGMA table_info(${table})`).all().filter(row => row.pk)
      .sort((left, right) => left.pk - right.pk).map(row => quote_identifier(row.name));
    hash.update(item.name);
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${keys.length ? keys.join(",") : "rowid"}`).iterate()) {
      if (item.name === "storage_metadata") row.format_version = 11;
      hash.update(digest(row));
    }
  }
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
    hash.update(digest(database.prepare("SELECT name,seq FROM sqlite_sequence ORDER BY name").all()));
  }
  return hash.digest("hex");
}

/** 审阅证据只包含计数和摘要，不包含聊天正文；错误格式和非正式 DDL 均拒绝。 */
export function inspect_database(database, agent_id, historical) {
  if (historical.AGENT_SESSION_SCHEMA_VERSION !== 10) fail("v11_conversion_source_runtime_mismatch");
  assert_protocol_database(database, agent_id, historical);
  validate_v9(database, agent_id, historical);
  const counts = Object.fromEntries(["sessions", "messages", "message_parts"].map(table => [table,
    Number(database.prepare(`SELECT count(*) AS total FROM ${table}`).get().total)]));
  return { ...counts, content_sha256: content_digest(database), source_fingerprint: database_fingerprint(database) };
}

/**
 * 在私有 stage 内临时保存行，再按正式原表名重建，避免 RENAME 改写其他表的外键。
 * 复制完成后才恢复本表触发器，防止重复增加会话计数或修改稳定水位。
 */
function rebuild_table(database, expected, name) {
  const table = quote_identifier(name);
  const temporary = quote_identifier(`session_v11_${name}`);
  const ddl = expected.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql;
  const dependents = database.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND sql IS NOT NULL AND type IN ('index','trigger') ORDER BY type,name").all(name);
  const columns = database.prepare(`PRAGMA table_info(${table})`).all().map(row => quote_identifier(row.name));
  database.exec(`CREATE TEMP TABLE ${temporary} AS SELECT * FROM ${table}; DROP TABLE ${table};`);
  database.exec(ddl);
  const select = columns.map(column => name === "storage_metadata" && column === '"format_version"' ? "11" : column);
  database.exec(`INSERT INTO ${table} (${columns.join(",")}) SELECT ${select.join(",")} FROM temp.${temporary}; DROP TABLE temp.${temporary};`);
  for (const item of dependents) database.exec(item.sql);
}

/** 从精确源快照生成新文件，不覆盖源或已有目标；失败副本由调用方审阅和重试。 */
export async function convert_database(source_path, target_path, agent_id, historical, runtime, expected_proof) {
  if (runtime.AGENT_SESSION_SCHEMA_VERSION !== 11) fail("v11_conversion_target_runtime_mismatch");
  if (exists(target_path)) fail("conversion_target_already_exists");
  const source = open_source(source_path);
  try {
    const proof = inspect_database(source, agent_id, historical);
    if (expected_proof && digest(proof) !== digest(expected_proof)) fail("conversion_plan_changed_since_preflight");
    await backup(source, target_path); fs.chmodSync(target_path, 0o600);
    const target = new DatabaseSync(target_path);
    const expected = new DatabaseSync(":memory:");
    try {
      expected.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
      target.exec("PRAGMA foreign_keys=OFF; BEGIN EXCLUSIVE;");
      rebuild_table(target, expected, "messages");
      rebuild_table(target, expected, "storage_metadata");
      target.exec("PRAGMA user_version=11;");
      assert_protocol_database(target, agent_id, runtime);
      validate_v9(target, agent_id, runtime);
      if (content_digest(target) !== proof.content_sha256) fail("converted_business_content_mismatch");
      target.exec("COMMIT; PRAGMA foreign_keys=ON; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
      return proof;
    } finally { target.close(); expected.close(); }
  } finally { source.close(); }
}
