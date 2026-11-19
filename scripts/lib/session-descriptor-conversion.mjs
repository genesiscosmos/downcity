/** 旧 v12 → SessionDescriptor 的离线转换。只在暂存副本改写明确的目录和输入身份字段。 */
import fs from "node:fs";
import { createHash as create_hash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { check_integrity, digest, fail, quote_identifier } from "./session-v7-database.mjs";
import { database_fingerprint, open_source, row_writer, schema_descriptor } from "./session-v9-database.mjs";
import { assert_protocol_database } from "./session-v10-proof.mjs";

// 冻结已发布的 category/origin v12 DDL（排序后仅归一化空白）。两种结构共用版本号。
const source_schema_hash = "88de593f3c351cceb95cb64a763caa7ee0337b22a4be7f7c4a0fbf7975ce2703";
const rebuilt_tables = ["archive_operation_nodes", "archive_operations", "session_creation_keys", "sessions"];

/** 旧 Agent 自有会话归入 main，自定义用途沿用原来的标识。 */
function session_kind(type, kind) {
  if (!["chat", "work"].includes(type) || typeof kind !== "string" || !kind || kind !== kind.trim()) fail("session_descriptor_source_kind_invalid");
  return type === "chat" && kind === "agent" ? "main" : kind;
}

/** 保留创建方附加事实；只移动明确存在的父身份字段。 */
export function convert_origin(origin, type, runtime) {
  const { category, type: origin_type, parent_agent_id, parent_session_id, parent_session_category, ...metadata } = origin;
  if ((category !== undefined && category !== type) || "parent" in metadata || "kind" in metadata || "parent_session_type" in metadata) fail("session_descriptor_source_origin_invalid");
  const descriptor = { ...metadata, type, kind: session_kind(type, origin_type) };
  if ([parent_agent_id, parent_session_id, parent_session_category].some(value => value !== undefined)) {
    if (typeof parent_agent_id !== "string" || typeof parent_session_id !== "string" || !["chat", "work"].includes(parent_session_category)) fail("session_descriptor_source_parent_invalid");
    descriptor.parent = { agent_id: parent_agent_id, session_id: parent_session_id };
    descriptor.parent_session_type = parent_session_category;
  }
  return runtime.restore_session_descriptor(descriptor, type);
}

/** 数据库行的来源分区须与表中独立字段一致。 */
function convert_session(row, runtime) {
  const { category: type, origin, ...record } = row;
  const source = JSON.parse(origin);
  if (source.category !== type) fail("session_descriptor_source_origin_invalid");
  return { ...record, type, descriptor: JSON.stringify(convert_origin(source, type, runtime)) };
}

/** 只改写框架定义的 from；正文、回调、Power 内容和工具结果字节保持原样。 */
export function convert_actor(meta) {
  if (meta?.from?.kind !== "session" || !("category" in meta.from)) return false;
  const { category, ...actor } = meta.from;
  if ("type" in actor || !["chat", "work"].includes(category)) fail("session_descriptor_source_actor_invalid");
  meta.from = { ...actor, type: category };
  return true;
}

/** 保留无需转换的 JSON 原始字节，避免改变摘要或不可变消息边界。 */
function convert_message(row) {
  if (row.role !== "user" || row.meta === null) return row;
  const meta = JSON.parse(row.meta);
  return convert_actor(meta) ? { ...row, meta: JSON.stringify(meta) } : row;
}

/** agent 的 Input Part 使用同一份请求记账身份。 */
function convert_part(row) {
  if (row.type !== "input") return row;
  const content = JSON.parse(row.content);
  return convert_actor(content.meta) ? { ...row, content: JSON.stringify(content) } : row;
}

/** 归档计划仍使用原 UUID 和进度，按新字段重算不可变身份摘要。 */
function convert_archive_node({ category: type, origin_type, ...row }) {
  return { ...row, type, kind: session_kind(type, origin_type) };
}

/** 先验证旧计划证据，再派生新摘要，防止把已有损坏包装成有效记录。 */
function archive_hashes(database) {
  const fingerprints = new Map();
  const select = database.prepare(`SELECT position,session_id,category,origin_type,workspace_id FROM archive_operation_nodes
    WHERE operation_id=? ORDER BY position`);
  for (const operation of database.prepare("SELECT * FROM archive_operations").iterate()) {
    const { root_session_id, category, fingerprint } = operation;
    const nodes = select.all(operation.operation_id);
    if (digest({ root_session_id, category, nodes }) !== fingerprint) fail("session_archive_plan_corrupt");
    fingerprints.set(operation.operation_id, digest({ root_session_id, type: category, nodes: nodes.map(convert_archive_node) }));
  }
  return fingerprints;
}

/** 所有允许改写的字段集中在同一映射，写副本和前后摘要复用此规则。 */
function project_source(database, runtime) {
  const fingerprints = archive_hashes(database);
  return (table, row) => {
    if (table === "sessions") return convert_session(row, runtime);
    if (table === "messages") return convert_message(row);
    if (table === "message_parts") return convert_part(row);
    if (table === "archive_operation_nodes") return convert_archive_node(row);
    if (table !== "archive_operations" && table !== "session_creation_keys") return row;
    const { category: type, ...record } = row;
    return { ...record, type, ...(table === "archive_operations" ? { fingerprint: fingerprints.get(row.operation_id) } : {}) };
  };
}

/** 对源的预期内容和目标的实际内容做逐表、逐主键的全字段摘要。 */
export function content_digest(database, project = (_table, row) => row) {
  const hash = create_hash("sha256");
  for (const item of schema_descriptor(database).filter(row => row.type === "table")) {
    const table = quote_identifier(item.name);
    const keys = database.prepare(`PRAGMA table_info(${table})`).all().filter(row => row.pk)
      .sort((left, right) => left.pk - right.pk).map(row => quote_identifier(row.name));
    hash.update(item.name);
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${keys.length ? keys.join(",") : "rowid"}`).iterate()) {
      hash.update(digest(project(item.name, row)));
    }
  }
  if (database.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()) {
    hash.update(digest(database.prepare("SELECT name,seq FROM sqlite_sequence ORDER BY name").all()));
  }
  return hash.digest("hex");
}

/** 逐条用目标 codec 解码，核对消息计数、Part 顺序和主会话指针。 */
function validate_history(database, runtime, project) {
  const parts = database.prepare("SELECT * FROM message_parts WHERE session_key=? AND message_id=? ORDER BY sequence");
  const messages = database.prepare("SELECT * FROM messages WHERE session_key=? ORDER BY sequence");
  const pointer = database.prepare("SELECT main_session_id FROM agent_session_state").all();
  if (pointer.length !== 1) fail("main_session_pointer_invalid");
  let main_valid = pointer[0].main_session_id === null;
  for (const row of database.prepare("SELECT * FROM sessions ORDER BY session_key").iterate()) {
    const session = project ? project("sessions", row) : row;
    const descriptor = runtime.restore_session_descriptor(JSON.parse(session.descriptor), session.type);
    if (pointer[0].main_session_id === session.session_id) main_valid = !session.archived && descriptor.type === "chat" && descriptor.kind === "main";
    let count = 0;
    for (const message of messages.iterate(session.session_key)) {
      const rows = parts.all(session.session_key, message.message_id);
      if (rows.some((part, index) => part.sequence !== index + 1)) fail("non_contiguous_parts");
      try {
        runtime.decode_session_message(project ? project("messages", message) : message,
          project ? rows.map(part => project("message_parts", part)) : rows, session.session_id);
      } catch { fail("session_descriptor_message_codec_rejected"); }
      count++;
    }
    if (count !== session.message_count) fail("session_message_count_mismatch");
  }
  if (!main_valid) fail("main_session_pointer_invalid");
}

/** 预检冻结源结构、完整性、可解码性和全库指纹。 */
export function inspect_database(database, agent_id, historical) {
  const schema = schema_descriptor(database).map(item => ({ ...item, sql: item.sql?.replace(/\s+/gu, " ").trim() }));
  if (database.prepare("PRAGMA user_version").get().user_version !== 12 || digest(schema) !== source_schema_hash) fail("session_descriptor_source_schema_mismatch");
  const owner = database.prepare("SELECT agent_id,format_version FROM storage_metadata WHERE singleton_id=1").get();
  if (owner?.agent_id !== agent_id || owner.format_version !== 12) fail("session_storage_identity_conflict");
  check_integrity(database);
  const project = project_source(database, historical);
  validate_history(database, historical, project);
  const counts = Object.fromEntries(["sessions", "messages", "message_parts", "archive_operations"].map(table => [table,
    database.prepare(`SELECT count(*) AS total FROM ${quote_identifier(table)}`).get().total]));
  return { ...counts, content_sha256: content_digest(database, project), source_fingerprint: database_fingerprint(database) };
}

/** 用正式 DDL 重建变化的关系表；触发器在完整数据已落盘后按正式顺序安装。 */
function rebuild(target, source, expected, project) {
  for (const item of target.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all()) {
    target.exec(`DROP TRIGGER ${quote_identifier(item.name)}`);
  }
  for (const table of rebuilt_tables) target.exec(`DROP TABLE ${quote_identifier(table)}`);
  const definitions = expected.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid").all();
  for (const item of definitions.filter(item => item.type === "table" && rebuilt_tables.includes(item.name))) {
    target.exec(item.sql);
    let insert;
    for (const row of source.prepare(`SELECT * FROM ${quote_identifier(item.name)}`).iterate()) {
      const converted = project(item.name, row);
      insert ??= row_writer(target, item.name, converted);
      insert(converted);
    }
  }
  const message_update = target.prepare("UPDATE messages SET meta=? WHERE session_key=? AND message_id=?");
  for (const row of source.prepare("SELECT * FROM messages WHERE role='user' AND meta IS NOT NULL").iterate()) {
    const converted = project("messages", row);
    if (converted !== row) message_update.run(converted.meta, row.session_key, row.message_id);
  }
  const part_update = target.prepare("UPDATE message_parts SET content=? WHERE session_key=? AND part_id=?");
  for (const row of source.prepare("SELECT * FROM message_parts WHERE type='input'").iterate()) {
    const converted = project("message_parts", row);
    if (converted !== row) part_update.run(converted.content, row.session_key, row.part_id);
  }
  for (const item of definitions) {
    if (item.type === "trigger" || (item.type === "index" && rebuilt_tables.includes(item.tbl_name))) target.exec(item.sql);
  }
}

/** 原始备份必须匹配预检，目标副本通过完整 DDL、外键、解码和内容摘要才允许发布。 */
export async function convert_database(source_path, target_path, agent_id, historical, runtime, proof) {
  const source = open_source(source_path);
  try {
    if (database_fingerprint(source) !== proof.source_fingerprint) fail("conversion_plan_changed_since_preflight");
    await backup(source, target_path);
    fs.chmodSync(target_path, 0o600);
    const target = new DatabaseSync(target_path);
    const expected = new DatabaseSync(":memory:");
    try {
      expected.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
      target.exec("PRAGMA foreign_keys=OFF; BEGIN EXCLUSIVE;");
      rebuild(target, source, expected, project_source(source, historical));
      assert_protocol_database(target, agent_id, runtime);
      validate_history(target, runtime);
      if (content_digest(target) !== proof.content_sha256) fail("converted_business_content_mismatch");
      target.exec("COMMIT; PRAGMA foreign_keys=ON; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    } finally { target.close(); expected.close(); }
  } finally { source.close(); }
}
