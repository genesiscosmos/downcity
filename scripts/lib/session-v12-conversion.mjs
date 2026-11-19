/**
 * v11→v12 的消息协议转换：inbox/inbox_id 改为 input/input_id，power 改为 view。
 * 仅转换独立副本；稳定身份、水位、配置、收据、工具结果引用和附件保持原值。
 */
import fs from "node:fs";
import { createHash as create_hash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { digest, fail, quote_identifier } from "./session-v7-database.mjs";
import { exists } from "./session-v8-files.mjs";
import { open_source, database_fingerprint, schema_descriptor, validate_v9 } from "./session-v9-database.mjs";
import { assert_protocol_database } from "./session-v10-proof.mjs";

/** JSON 日志与 SQLite 共享运行时输入身份映射。 */
export function convert_input_identity({ inbox_id, ...content }) {
  if (typeof inbox_id !== "string" || !inbox_id || "input_id" in content) fail("v12_input_identity_invalid");
  return { input_id: inbox_id, ...content };
}

/** 只解释框架字段，不递归替换正文、业务数据或工具快照。 */
export function convert_part(row) {
  if (row.type === "power") return { ...row, type: "view" };
  if (row.type !== "inbox") return row;
  return { ...row, type: "input", content: JSON.stringify(convert_input_identity(JSON.parse(row.content))) };
}

/** 单记录包与整库迁移共用相同映射，不清除 Composer 边界或修改原记录。 */
export function convert_record(record) {
  return { ...record, message_parts: record.message_parts.map(convert_part) };
}

/** 对源和目标使用同一规范视图，允许变化的字段只限格式版本和已声明的 Part 映射。 */
function normalized_row(table, row) {
  if (table === "storage_metadata") return { ...row, format_version: 12 };
  return table === "message_parts" ? convert_part(row) : row;
}

/** 流式逐表哈希包含所有业务字段；单行内存有界，未变更的 JSON 保留原始字节。 */
export function content_digest(database) {
  const hash = create_hash("sha256");
  for (const item of schema_descriptor(database).filter(row => row.type === "table")) {
    const table = quote_identifier(item.name);
    const keys = database.prepare(`PRAGMA table_info(${table})`).all().filter(row => row.pk)
      .sort((left, right) => left.pk - right.pk).map(row => quote_identifier(row.name));
    hash.update(item.name);
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${keys.length ? keys.join(",") : "rowid"}`).iterate()) {
      hash.update(digest(normalized_row(item.name, row)));
    }
  }
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
    hash.update(digest(database.prepare("SELECT name,seq FROM sqlite_sequence ORDER BY name").all()));
  }
  return hash.digest("hex");
}

/** 正式 v11 DDL、身份、外键和全部消息先通过冻结 codec，预检不创建或修改源文件。 */
export function inspect_database(database, agent_id, historical) {
  if (historical.AGENT_SESSION_SCHEMA_VERSION !== 11) fail("v12_source_runtime_mismatch");
  assert_protocol_database(database, agent_id, historical);
  validate_v9(database, agent_id, historical);
  const counts = Object.fromEntries(["sessions", "messages", "message_parts"].map(table => [table,
    Number(database.prepare(`SELECT count(*) AS total FROM ${table}`).get().total)]));
  const renamed_parts = Object.fromEntries(database.prepare("SELECT type,count(*) AS total FROM message_parts WHERE type IN ('inbox','power') GROUP BY type").all()
    .map(row => [row.type, row.total]));
  return { ...counts, renamed_parts, content_sha256: content_digest(database), source_fingerprint: database_fingerprint(database) };
}

/** 只在私有副本重建版本表与 Parts，完成数据复制后安装目标索引和不可变前缀触发器。 */
function rebuild_table(database, expected, name) {
  const table = quote_identifier(name);
  const temporary = quote_identifier(`session_v12_${name}`);
  const ddl = expected.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql;
  const dependents = expected.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND sql IS NOT NULL AND type IN ('index','trigger') ORDER BY type,name").all(name);
  const columns = database.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  database.exec(`CREATE TEMP TABLE ${temporary} AS SELECT * FROM ${table}; DROP TABLE ${table};`);
  database.exec(ddl);
  const insert = database.prepare(`INSERT INTO ${table} (${columns.map(quote_identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  for (const row of database.prepare(`SELECT * FROM temp.${temporary}`).iterate()) {
    const normalized = normalized_row(name, row);
    insert.run(...columns.map(column => normalized[column]));
  }
  database.exec(`DROP TABLE temp.${temporary};`);
  for (const item of dependents) database.exec(item.sql);
}

/** SQLite 一致性备份后在目标事务内转换；源、目标的规范内容摘要必须完全一致。 */
export async function convert_database(source_path, target_path, agent_id, historical, runtime, expected_proof) {
  if (runtime.AGENT_SESSION_SCHEMA_VERSION !== 12) fail("v12_target_runtime_mismatch");
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
      rebuild_table(target, expected, "message_parts");
      rebuild_table(target, expected, "storage_metadata");
      target.exec("PRAGMA user_version=12;");
      assert_protocol_database(target, agent_id, runtime);
      validate_v9(target, agent_id, runtime);
      if (content_digest(target) !== proof.content_sha256) fail("converted_business_content_mismatch");
      target.exec("COMMIT; PRAGMA foreign_keys=ON; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
      return proof;
    } finally { target.close(); expected.close(); }
  } finally { source.close(); }
}
