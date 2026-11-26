/** 单记录转移的canonical/配置/Composer读写与正式schema校验，不创建执行器。 */
import { assert_transfer_runtime } from "./session-transfer-protocol.mjs";
import { validate_protocol_record as validate_historical_record } from "./session-transfer-historical-record.mjs";
import path from "node:path";
import { fileURLToPath as file_url_to_path, pathToFileURL as path_to_file_url } from "node:url";
import { randomUUID as random_uuid, randomBytes as random_bytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { digest, fail, check_integrity } from "./session-v7-database.mjs";

export const record_tables = ["messages", "message_parts", "composer_checkpoints"];
export { uuid_pattern } from "./session-v9-identities.mjs";
import { uuid_pattern } from "./session-v9-identities.mjs";

/** 只读取精确记录，不查询逻辑ID候选，不导出其他Session或全库receipt。 */
export function read_record(database, session_id) {
  if (!uuid_pattern.test(session_id)) fail("transfer_session_id_invalid");
  const row = database.prepare("SELECT * FROM sessions WHERE session_id=?").get(session_id);
  if (!row) fail("transfer_session_not_found");
  const { session_key, ...metadata } = row;
  const { session_key: _key, ...configuration } = database.prepare("SELECT * FROM session_configuration WHERE session_key=?").get(session_key);
  const record = { metadata, configuration };
  for (const table of record_tables) record[table] = database.prepare(`SELECT * FROM ${table} WHERE session_key=? ORDER BY ${table === "messages" ? "sequence" : table === "message_parts" ? "message_id,sequence" : "namespace,through_message_sequence,through_part_sequence"}`)
    .all(session_key).map(({ session_key: _session_key, ...item }) => item);
  return record;
}

/** 全字段参数绑定，拒绝包字段被当作任意SQL标识符。 */
function insert(database, table, row) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
  if (Object.keys(row).some(name => !columns.includes(name))) fail("transfer_record_fields_invalid");
  const names = Object.keys(row);
  database.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(row));
}

/** 在调用方单一事务中导入；稳定水位在Parts后恢复，Composer最后校验其原边界。 */
export function insert_record(database, record) {
  insert(database, "sessions", record.metadata);
  const session_key = Number(database.prepare("SELECT session_key FROM sessions WHERE session_id=?").get(record.metadata.session_id).session_key);
  const config = record.configuration;
  if (Object.keys(config).sort().join(",") !== "approval_mode,execution_profile,system_snapshot") fail("transfer_configuration_invalid");
  database.prepare("UPDATE session_configuration SET approval_mode=?,execution_profile=?,system_snapshot=? WHERE session_key=?")
    .run(config.approval_mode, config.execution_profile, config.system_snapshot, session_key);
  const creation_key = config.execution_profile ? JSON.parse(config.execution_profile).creation_key : undefined;
  if (creation_key !== undefined) database.prepare("INSERT INTO session_creation_keys(type,creation_key,session_id) VALUES(?,?,?)")
    .run(record.metadata.type, creation_key, record.metadata.session_id);
  for (const row of record.messages) insert(database, "messages", { ...row, stable_part_sequence: 0, session_key });
  for (const row of record.message_parts) insert(database, "message_parts", { ...row, session_key });
  for (const row of record.messages) if (row.stable_part_sequence) database.prepare("UPDATE messages SET stable_part_sequence=? WHERE session_key=? AND message_id=?").run(row.stable_part_sequence, session_key, row.message_id);
  for (const row of record.composer_checkpoints) insert(database, "composer_checkpoints", { ...row, session_key });
  return session_key;
}

/** 使用当前正式schema/codec/水位算法验证包，不能仅检查总数或JSON合法。 */
export function validate_record(record, agent_id, runtime) {
  assert_transfer_runtime(runtime);
  validate_protocol_record(record, agent_id, runtime);
}

/** 显式离线转换复用记录校验；历史 runtime 必须由调用方的冻结 loader 提供。 */
export function validate_protocol_record(record, agent_id, runtime) {
  if (runtime.AGENT_SESSION_SCHEMA_VERSION < 13) return validate_historical_record(record, agent_id, runtime);
  // 显式离线转换允许冻结 v13 校验；当前导入入口仍先经 assert_transfer_runtime 门禁。
  if (![13, 14].includes(runtime.AGENT_SESSION_SCHEMA_VERSION)) fail("transfer_runtime_version_mismatch");
  if (!record || Object.keys(record).sort().join(",") !== "composer_checkpoints,configuration,message_parts,messages,metadata"
    || !uuid_pattern.test(record.metadata?.session_id ?? "") || !record_tables.every(table => Array.isArray(record[table]))) fail("transfer_record_invalid");
  if (record.metadata.message_count !== record.messages.length) fail("transfer_count_invalid");
  const relations = JSON.parse(record.metadata.relations);
  if (!relations || typeof relations !== "object" || Array.isArray(relations)
    || "type" in relations || "kind" in relations) fail("transfer_relations_invalid");
  runtime.restore_session_descriptor({ ...relations, type: record.metadata.type, kind: record.metadata.kind }, record.metadata.type);
  const message_ids = new Set(record.messages.map(message => message.message_id));
  if (record.message_parts.some(part => !message_ids.has(part.message_id))) fail("transfer_part_orphan");
  for (const message of record.messages) {
    const parts = record.message_parts.filter(part => part.message_id === message.message_id).sort((a, b) => a.sequence - b.sequence);
    if (parts.some((part, index) => part.sequence !== index + 1)) fail("transfer_part_sequence_invalid");
    const decoded = runtime.decode_session_message(message, parts, record.metadata.session_id);
    if (decoded.role === "agent") {
      const stable = message.stable_part_sequence;
      if (stable > runtime.resolve_stable_part_sequence(decoded.parts, 0)
        || decoded.parts.some(part => part.step_id && part.sequence <= stable
          && decoded.parts.some(next => next.step_id === part.step_id && next.sequence > stable))) fail("transfer_stable_prefix_invalid");
    }
    if (Boolean(message.origin_session_id) !== Boolean(message.origin_message_id) || (message.origin_turn_id && !message.origin_session_id)) fail("transfer_origin_invalid");
  }
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    database.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
    database.prepare("INSERT INTO storage_metadata(singleton_id,agent_id,format_version,generation,cursor_secret,created_at) VALUES(1,?,?,?,?,?)").run(agent_id, runtime.AGENT_SESSION_SCHEMA_VERSION, random_uuid(), random_bytes(32), Date.now());
    insert_record(database, record);
    database.exec(`PRAGMA user_version=${runtime.AGENT_SESSION_SCHEMA_VERSION};`); check_integrity(database);
    if (digest(read_record(database, record.metadata.session_id)) !== digest(record)) fail("transfer_semantic_mismatch");
  } finally { database.close(); }
}

/** 仅重绑 file 和协议声明的运行时输入附件；Tool 与任意正文不做全局字符串替换。 */
export function rebind_record(record, source_root, target_root, files, runtime) {
  const result = structuredClone(record);
  const rewrite = item => {
    if (typeof item.url !== "string") fail("transfer_attachment_url_invalid");
    let file_path = item.url;
    if (file_path.startsWith("file:")) {
      try { file_path = file_url_to_path(file_path); } catch { fail("transfer_attachment_url_invalid"); }
    }
    if (!path.isAbsolute(file_path)) return item;
    const relative = path.relative(source_root, file_path);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return item;
    const file = files.find(file => file.relative_path === relative);
    if (!file) fail("transfer_attachment_missing");
    const target = path.join(target_root, relative);
    return { ...item, url: item.url.startsWith("file:") ? path_to_file_url(target).href : target, ...(item.media_version === file.source_media_version && file.target_media_version ? { media_version: file.target_media_version } : {}) };
  };
  const hint = (context, before, after) => {
    if (context.tag !== "attachment_path" || before?.type !== "file" || after?.type !== "file") return context;
    const prefix = `对应${before.media_type.startsWith("image/") ? "图片" : "附件"}路径：`;
    return context.context === `${prefix}${before.url}` ? { ...context, context: `${prefix}${after.url}` } : context;
  };
  for (const part of result.message_parts) {
    const before = JSON.parse(part.content);
    if (part.type === "file") part.content = JSON.stringify(rewrite(before));
    else if (part.type === (runtime.AGENT_SESSION_SCHEMA_VERSION >= 12 ? "input" : "inbox")) {
      const content = before.content.map(item => item.type === "file" ? rewrite(item) : item);
      for (let index = 0; index < content.length; index++) if (content[index].type === "context") content[index] = hint(content[index], before.content[index - 1], content[index - 1]);
      part.content = JSON.stringify({ ...before, content });
    }
  }
  for (const message of result.messages) {
    const before = record.message_parts.filter(part => part.message_id === message.message_id).sort((a, b) => a.sequence - b.sequence);
    const after = result.message_parts.filter(part => part.message_id === message.message_id).sort((a, b) => a.sequence - b.sequence);
    for (let index = 1; index < after.length; index++) if (after[index].type === "context") {
      after[index].content = JSON.stringify(hint(JSON.parse(after[index].content), { type: before[index - 1].type, ...JSON.parse(before[index - 1].content) }, { type: after[index - 1].type, ...JSON.parse(after[index - 1].content) }));
    }
  }
  validate_protocol_record(result, runtime.agent_id, runtime);
  return result;
}
