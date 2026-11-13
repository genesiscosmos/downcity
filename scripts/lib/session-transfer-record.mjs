/** 单记录转移的canonical/配置/Composer读写与正式schema校验，不创建执行器。 */
import path from "node:path";
import { randomUUID as random_uuid, randomBytes as random_bytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { digest, fail, check_integrity } from "./session-v7-database.mjs";

export const record_tables = ["messages", "message_parts", "composer_checkpoints"];
export const uuid_pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

/** 只读取精确记录，不查询逻辑ID候选，不导出其他Session或全库receipt。 */
export function read_record(database, storage_id) {
  if (!uuid_pattern.test(storage_id)) fail("transfer_storage_id_invalid");
  const row = database.prepare("SELECT * FROM sessions WHERE storage_id=?").get(storage_id);
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
  const session_key = Number(database.prepare("SELECT session_key FROM sessions WHERE storage_id=?").get(record.metadata.storage_id).session_key);
  const config = record.configuration;
  if (Object.keys(config).sort().join(",") !== "approval_mode,execution_profile,model_binding,system_snapshot") fail("transfer_configuration_invalid");
  database.prepare("UPDATE session_configuration SET model_binding=?,approval_mode=?,execution_profile=?,system_snapshot=? WHERE session_key=?")
    .run(config.model_binding, config.approval_mode, config.execution_profile, config.system_snapshot, session_key);
  for (const row of record.messages) insert(database, "messages", { ...row, stable_part_sequence: 0, session_key });
  for (const row of record.message_parts) insert(database, "message_parts", { ...row, session_key });
  for (const row of record.messages) if (row.stable_part_sequence) database.prepare("UPDATE messages SET stable_part_sequence=? WHERE session_key=? AND message_id=?").run(row.stable_part_sequence, session_key, row.message_id);
  for (const row of record.composer_checkpoints) insert(database, "composer_checkpoints", { ...row, session_key });
  return session_key;
}

/** 使用当前正式schema/codec/水位算法验证包，不能仅检查总数或JSON合法。 */
export function validate_record(record, agent_id, runtime) {
  if (!record || Object.keys(record).sort().join(",") !== "composer_checkpoints,configuration,message_parts,messages,metadata"
    || !uuid_pattern.test(record.metadata?.storage_id ?? "") || !record_tables.every(table => Array.isArray(record[table]))) fail("transfer_record_invalid");
  if (record.metadata.message_count !== record.messages.length) fail("transfer_count_invalid");
  const origin = JSON.parse(record.metadata.origin);
  runtime.restore_session_origin(origin, record.metadata.category);
  if (origin.category !== record.metadata.category) fail("transfer_origin_invalid");
  if (record.configuration.model_binding) runtime.decode_model_binding(record.configuration.model_binding);
  const message_ids = new Set(record.messages.map(message => message.message_id));
  if (record.message_parts.some(part => !message_ids.has(part.message_id))) fail("transfer_part_orphan");
  for (const message of record.messages) {
    const parts = record.message_parts.filter(part => part.message_id === message.message_id).sort((a, b) => a.sequence - b.sequence);
    if (parts.some((part, index) => part.sequence !== index + 1)) fail("transfer_part_sequence_invalid");
    const decoded = runtime.decode_session_message(message, parts, record.metadata.session_id);
    if (decoded.role === "agent" && message.stable_part_sequence > runtime.resolve_stable_part_sequence(decoded.parts, 0)) fail("transfer_stable_prefix_invalid");
    if (Boolean(message.origin_session_id) !== Boolean(message.origin_message_id) || (message.origin_turn_id && !message.origin_session_id)) fail("transfer_origin_invalid");
  }
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    database.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
    database.prepare("INSERT INTO storage_metadata(singleton_id,agent_id,format_version,generation,cursor_secret,created_at) VALUES(1,?,8,?,?,?)").run(agent_id, random_uuid(), random_bytes(32), Date.now());
    insert_record(database, record);
    database.exec("PRAGMA user_version=8;"); check_integrity(database);
    if (digest(read_record(database, record.metadata.storage_id)) !== digest(record)) fail("transfer_semantic_mismatch");
  } finally { database.close(); }
}

/** 仅重绑file/inbox所属URL与精确框架路径提示，Tool/任意正文引用不做全局字符串替换。 */
export function rebind_record(record, source_root, target_root, files, runtime) {
  const result = structuredClone(record);
  const rewrite = item => {
    if (typeof item.url !== "string") fail("transfer_attachment_url_invalid");
    if (!path.isAbsolute(item.url)) return item;
    const relative = path.relative(source_root, item.url);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return item;
    const file = files.find(file => file.relative_path === relative);
    if (!file) fail("transfer_attachment_missing");
    return { ...item, url: path.join(target_root, relative), ...(item.media_version === file.source_media_version && file.target_media_version ? { media_version: file.target_media_version } : {}) };
  };
  const hint = (context, before, after) => {
    if (context.tag !== "attachment_path" || before?.type !== "file" || after?.type !== "file") return context;
    const prefix = `对应${before.media_type.startsWith("image/") ? "图片" : "附件"}路径：`;
    return context.context === `${prefix}${before.url}` ? { ...context, context: `${prefix}${after.url}` } : context;
  };
  for (const part of result.message_parts) {
    const before = JSON.parse(part.content);
    if (part.type === "file") part.content = JSON.stringify(rewrite(before));
    else if (part.type === "inbox") {
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
  validate_record(result, runtime.agent_id, runtime);
  return result;
}
