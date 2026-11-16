/**
 * v9 离线转换的数据库边界：冻结 v8 契约、流式指纹与当前 codec 校验。
 * 只读源连接始终持有一致性事务；不加载整库历史，不启动 Agent 或模型。
 */
import fs from "node:fs";
import { createHash as create_hash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { check_integrity, digest, fail, quote_identifier } from "./session-v7-database.mjs";
import { exists, ordinary } from "./session-v8-files.mjs";

export const v8_schema = fs.readFileSync(new URL("../fixtures/session-v8.sql", import.meta.url), "utf8");

/** 一致性快照包含已提交 WAL，不 checkpoint 源库。 */
export function open_source(database_path) {
  ordinary(database_path);
  for (const suffix of ["-wal", "-shm"]) if (exists(`${database_path}${suffix}`)) ordinary(`${database_path}${suffix}`);
  const database = new DatabaseSync(database_path, { readOnly: true });
  try { database.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=250; BEGIN;"); return database; }
  catch (error) { database.close(); throw error; }
}

/** 完整 DDL 是协议的一部分，不能只校验版本号。 */
export function schema_descriptor(database) {
  return database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
}

/** 仅归一化空白，不忽略约束或索引。 */
function normalized_schema(items) {
  return items.map(item => ({ ...item, sql: item.sql?.replace(/\s+/gu, " ").trim() }));
}

/** 冻结 v8 结构和拥有者校验，未完成归档必须先由原版本收口。 */
export function assert_v8_database(database, agent_id) {
  if (database.prepare("PRAGMA user_version").get().user_version !== 8) fail("source_is_not_v8");
  const expected = new DatabaseSync(":memory:");
  try {
    expected.exec(v8_schema);
    if (digest(normalized_schema(schema_descriptor(database))) !== digest(normalized_schema(schema_descriptor(expected)))) fail("v8_schema_definition_mismatch");
  } finally { expected.close(); }
  const rows = database.prepare("SELECT agent_id,format_version FROM storage_metadata").all();
  if (rows.length !== 1 || rows[0].agent_id !== agent_id || rows[0].format_version !== 8) fail("source_identity_mismatch");
  check_integrity(database);
}

/** 按主键流式计算全库逻辑指纹，内存上限取决于单行大小。 */
export function database_fingerprint(database) {
  const hash = create_hash("sha256");
  const schema = schema_descriptor(database);
  hash.update(digest([database.prepare("PRAGMA user_version").get(), schema]));
  for (const item of schema.filter(item => item.type === "table")) {
    const table = quote_identifier(item.name);
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    const keys = columns.filter(column => column.pk).sort((left, right) => left.pk - right.pk).map(column => quote_identifier(column.name));
    hash.update(item.name);
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${keys.length ? keys.join(",") : "rowid"}`).iterate()) hash.update(digest(row));
  }
  // 自增水位即使高于现存最大行也不能丢；否则恢复会复用已删除的业务身份。
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
    hash.update(digest(database.prepare("SELECT name,seq FROM sqlite_sequence ORDER BY name").all()));
  }
  return hash.digest("hex");
}

/** 文件指纹包括 schema 和全部表，能识别业务写入与备份变化。 */
export function fingerprint_file(database_path) {
  const database = open_source(database_path);
  try { return database_fingerprint(database); } finally { database.close(); }
}

/** SQL 标识来自可信协议，业务值一律参数绑定。 */
export function row_writer(database, table, sample) {
  const columns = Object.keys(sample);
  const insert = database.prepare(`INSERT INTO ${quote_identifier(table)} (${columns.map(quote_identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  return row => insert.run(...columns.map(column => row[column]));
}

/** 目标逐消息接受正式 codec 校验，计数、外键和主会话指针必须一致。 */
export function validate_v9(database, agent_id, runtime) {
  runtime.assert_agent_session_schema(database, agent_id);
  check_integrity(database);
  const parts = database.prepare("SELECT * FROM message_parts WHERE session_key=? AND message_id=? ORDER BY sequence");
  for (const session of database.prepare("SELECT * FROM sessions ORDER BY session_key").iterate()) {
    let count = 0;
    for (const message of database.prepare("SELECT * FROM messages WHERE session_key=? ORDER BY sequence").iterate(session.session_key)) {
      const rows = parts.all(session.session_key, message.message_id);
      if (rows.some((part, index) => part.sequence !== index + 1)) fail("non_contiguous_parts");
      try { runtime.decode_session_message(message, rows, session.session_id); }
      catch { fail("v9_message_codec_rejected"); }
      count++;
    }
    if (count !== session.message_count) fail("session_message_count_mismatch");
  }
  const state = database.prepare("SELECT main_session_id FROM agent_session_state").all();
  if (state.length !== 1) fail("main_session_pointer_invalid");
  if (state[0].main_session_id && !database.prepare("SELECT 1 FROM sessions WHERE session_id=? AND archived=0 AND category='chat' AND json_extract(origin,'$.type')='agent'").get(state[0].main_session_id)) fail("main_session_pointer_invalid");
}
