/**
 * v13→v14 离线转换：用通用 Agent KV 承接宿主默认房间配置。
 * 从只读备份重建最终 schema；原会话、消息、附件及身份保持不变，废弃字段不进入目标库。
 */
import fs from "node:fs";
import { createHash as create_hash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { check_integrity, digest, fail, quote_identifier } from "./session-v7-database.mjs";
import { database_fingerprint, open_source, schema_descriptor, row_writer } from "./session-v9-database.mjs";
import { assert_protocol_database } from "./session-v10-proof.mjs";
import { exists } from "./session-v8-files.mjs";

/** 历史字段只用于离线源结构核验；运行时和目标 schema 始终只有最终定义。 */
function assert_source_database(database, agent_id, historical) {
  try { assert_protocol_database(database, agent_id, historical); }
  catch (error) {
    if (error.migration_code !== "session_protocol_schema_mismatch") throw error;
    const source_schema = historical.AGENT_SESSION_SCHEMA_SQL.replace("  approval_mode TEXT",
      "  model_binding TEXT CHECK (model_binding IS NULL OR (json_valid(model_binding) AND json_type(model_binding) = 'object')),\n  approval_mode TEXT");
    assert_protocol_database(database, agent_id, { ...historical, AGENT_SESSION_SCHEMA_SQL: source_schema });
  }
}

/** 版本与废弃配置的唯一转换规则，写目标库和内容摘要必须使用同一投影。 */
function project_row(table, row) {
  if (table === "storage_metadata") return { ...row, format_version: 14 };
  if (table === "session_configuration") {
    const { model_binding: _model_binding, ...configuration } = row;
    return configuration;
  }
  return row;
}

/** 源指针仅在迁移中解释为 Desktop 的宿主变量，不成为 SDK 运行策略。 */
function desktop_variable(database) {
  const rows = database.prepare("SELECT main_session_id FROM agent_session_state").all();
  if (rows.length !== 1) fail("source_main_pointer_invalid");
  const session_id = rows[0].main_session_id;
  if (session_id === null) return [];
  const session = database.prepare("SELECT type, kind, archived FROM sessions WHERE session_id=?").get(session_id);
  if (!session || session.type !== "chat" || session.kind !== "main" || session.archived) fail("source_main_pointer_invalid");
  return [{ key: "desktop.main_chatroom", value: JSON.stringify(session_id) }];
}

/** 内容证明按目标表名及主键稳定排序；只允许显式声明的 v14 字段变化。 */
export function content_digest(database, project = false) {
  const hash = create_hash("sha256");
  const tables = schema_descriptor(database).filter(row => row.type === "table" && (!project || row.name !== "agent_session_state"));
  if (project) tables.push({ name: "agent_variables" });
  for (const { name } of tables.sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(name);
    if (project && name === "agent_variables") {
      for (const row of desktop_variable(database)) hash.update(digest(row));
      continue;
    }
    const table = quote_identifier(name);
    const keys = database.prepare(`PRAGMA table_info(${table})`).all().filter(row => row.pk)
      .sort((left, right) => left.pk - right.pk).map(row => quote_identifier(row.name));
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${keys.length ? keys.join(",") : "rowid"}`).iterate()) {
      hash.update(digest(project ? project_row(name, row) : row));
    }
  }
  return hash.digest("hex");
}

/** 用冻结协议与 codec 核验所有历史，不把损坏数据包装成新格式。 */
function validate_history(database, runtime) {
  const messages = database.prepare("SELECT * FROM messages WHERE session_key=? ORDER BY sequence");
  const parts = database.prepare("SELECT * FROM message_parts WHERE session_key=? AND message_id=? ORDER BY sequence");
  for (const session of database.prepare("SELECT * FROM sessions ORDER BY session_key").iterate()) {
    runtime.restore_session_descriptor({ ...JSON.parse(session.relations), type: session.type, kind: session.kind }, session.type);
    let count = 0;
    for (const message of messages.iterate(session.session_key)) {
      const rows = parts.all(session.session_key, message.message_id);
      if (rows.some((part, index) => part.sequence !== index + 1)) fail("non_contiguous_parts");
      try { runtime.decode_session_message(message, rows, session.session_id); }
      catch { fail("session_variables_message_codec_rejected"); }
      count++;
    }
    if (count !== session.message_count) fail("session_message_count_mismatch");
  }
}

/** 冻结源 schema、完整消息和目标内容摘要，供批次发布前后验收。 */
export function inspect_database(database, agent_id, historical, runtime) {
  if (historical.AGENT_SESSION_SCHEMA_VERSION !== 13 || runtime.AGENT_SESSION_SCHEMA_VERSION !== 14) fail("v14_conversion_runtime_mismatch");
  assert_source_database(database, agent_id, historical);
  check_integrity(database);
  desktop_variable(database);
  validate_history(database, historical);
  const counts = Object.fromEntries(["sessions", "messages", "message_parts", "archive_operations"].map(table => [table,
    database.prepare(`SELECT count(*) AS total FROM ${quote_identifier(table)}`).get().total]));
  return { ...counts, content_sha256: content_digest(database, true), source_fingerprint: database_fingerprint(database) };
}

/** 按正式 v14 schema 创建私有暂存库；只写最终字段，保留所有未废弃的业务事实。 */
export async function convert_database(source_path, target_path, agent_id, historical, runtime, proof) {
  if (exists(target_path)) fail("conversion_target_already_exists");
  const source = open_source(source_path);
  try {
    const actual = inspect_database(source, agent_id, historical, runtime);
    if (proof && digest(actual) !== digest(proof)) fail("conversion_plan_changed_since_preflight");
    fs.closeSync(fs.openSync(target_path, "wx", 0o600));
    const target = new DatabaseSync(target_path);
    try {
      target.exec("PRAGMA foreign_keys=OFF; BEGIN EXCLUSIVE;");
      target.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
      const triggers = schema_descriptor(target).filter(item => item.type === "trigger");
      // 迁移直接恢复稳定边界与配置记录，不能触发业务写入时的派生插入或不可变限制。
      for (const { name } of triggers) target.exec(`DROP TRIGGER ${quote_identifier(name)}`);
      for (const { name } of schema_descriptor(target).filter(item => item.type === "table")) {
        const rows = name === "agent_variables" ? desktop_variable(source)
          : source.prepare(`SELECT * FROM ${quote_identifier(name)}`).iterate();
        let write;
        for (const source_row of rows) {
          const row = project_row(name, source_row);
          write ??= row_writer(target, name, row);
          write(row);
        }
      }
      for (const { sql } of triggers) target.exec(sql);
      target.exec("PRAGMA user_version=14;");
      assert_protocol_database(target, agent_id, runtime);
      check_integrity(target);
      validate_history(target, runtime);
      if (content_digest(target) !== actual.content_sha256) fail("converted_business_content_mismatch");
      target.exec("COMMIT; PRAGMA foreign_keys=ON; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    } catch (error) {
      if (target.isTransaction) target.exec("ROLLBACK;");
      throw error;
    } finally { target.close(); }
  } finally { source.close(); }
}
