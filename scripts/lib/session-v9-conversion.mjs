/**
 * v8 到 v9 的纯数据转换：Session 身份、fork、输入来源、附件 URL 与结果引用。
 * 不修改源库；在新数据库事务中导入，随后恢复全部正式触发器并使用当前 codec 校验。
 */
import path from "node:path";
import { fileURLToPath as file_url_to_path, pathToFileURL as path_to_file_url } from "node:url";
import { randomUUID as random_uuid, randomBytes as random_bytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { digest, fail, quote_identifier } from "./session-v7-database.mjs";
import { row_writer, schema_descriptor, validate_v9 } from "./session-v9-database.mjs";
import { create_resolver, identity_rows, rewrite_meta, rewrite_origin, rewrite_part } from "./session-v9-identities.mjs";
import { interrupted_messages } from "./session-v9-recovery-messages.mjs";
import { recover_group_origin } from "./session-v9-recovery.mjs";

/** 仅重绑当前根正式 session-files 下的路径，不更改任意正文和外部 Workspace 路径。 */
export function attachment_url(url, root_path, agents) {
  if (typeof url !== "string") return url;
  let file_path = url;
  if (url.startsWith("file:")) {
    try { file_path = file_url_to_path(url); } catch { fail("invalid_attachment_url"); }
  }
  if (!path.isAbsolute(file_path)) return url;
  const relative = path.relative(root_path, file_path).split(path.sep);
  if (relative[0] !== "agents" || relative[2] !== "session-files") return url;
  const agent = agents.find(item => item.agent_id === relative[1]);
  const record = agent?.identities.find(item => item.source_storage_id === relative[3]);
  if (!record) fail("attachment_record_not_found");
  relative[3] = record.session_id;
  const target = path.join(root_path, ...relative);
  return url.startsWith("file:") ? path_to_file_url(target).href : target;
}

/** 独立纯转换供 canonical Part 与完成日志共享，避免两份历史出现不同引用。 */
export function convert_part(content, type, agent_id, context) {
  const next = rewrite_part(content, type, agent_id, context.resolve, context.rewrite_reference);
  if (type === "file") return { ...next, url: attachment_url(next.url, context.root_path, context.agents) };
  if (type === "inbox") return { ...next, content: next.content.map(item => item.type === "file"
    ? { ...item, url: attachment_url(item.url, context.root_path, context.agents) } : item) };
  return next;
}

/** 字符串只在已声明的 JSON 列内解析；无修改则保留原 JSON 字节。 */
function convert_json(raw, transform) {
  if (raw === null) return null;
  const value = JSON.parse(raw); const next = transform(value);
  return digest(value) === digest(next) ? raw : JSON.stringify(next);
}

/** 新表的列集来自正式 schema，旧字段不能意外混入目标。 */
function target_row(database, table, row) {
  const keys = database.prepare(`PRAGMA table_info(${quote_identifier(table)})`).all().map(column => column.name);
  return Object.fromEntries(keys.map(key => [key, row[key]]));
}

/** 构建一个完整目标；内存预检与磁盘暂存走同一转换路径。 */
export function convert_database(source, agent, context, runtime, target_path = ":memory:") {
  // 暂存前逐行核对完整源事实，清单不能遗漏记录、调换 session_key 或伪装为本策略。
  create_resolver([agent]);
  if (digest(agent.identities) !== digest(identity_rows(source, agent.agent_id))) fail("identity_mapping_source_mismatch");
  if (source.prepare("SELECT 1 FROM archive_operations WHERE completed_at IS NULL LIMIT 1").get()) fail("pending_archive_operation");
  const interrupted = interrupted_messages(source, agent, context.recovery);
  const target = new DatabaseSync(target_path);
  try {
    target.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    target.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
    const triggers = schema_descriptor(target).filter(item => item.type === "trigger");
    // 离线导入保留稳定前缀与已完成归档事实，校验后必须重装所有正式触发器。
    for (const trigger of triggers) target.exec(`DROP TRIGGER ${quote_identifier(trigger.name)}`);
    const metadata = source.prepare("SELECT * FROM storage_metadata").get();
    row_writer(target, "storage_metadata", metadata)({ ...metadata, format_version: 9,
      generation: random_uuid(), cursor_secret: random_bytes(32), first_business_write_at: null });
    const by_key = new Map(agent.identities.map(row => [row.session_key, row]));
    let main_session_id = null;
    const insert_session = row => {
      const identity = by_key.get(row.session_key);
      const origin = recover_group_origin(rewrite_origin(JSON.parse(row.origin), agent.agent_id, context.resolve), context.recovery);
      if (!row.archived && row.category === "chat" && origin.type === "agent" && row.session_id === agent.agent_id) {
        // 旧协议主会话唯一地址等于 Agent ID，不能按最近更新或任意 agent 角色猜测。
        if (main_session_id) fail("ambiguous_main_session");
        main_session_id = identity.session_id;
      }
      const next = target_row(target, "sessions", { ...row, session_id: identity.session_id, origin: JSON.stringify(origin) });
      row_writer(target, "sessions", next)(next);
    };
    for (const row of source.prepare("SELECT * FROM sessions ORDER BY session_key").iterate()) insert_session(row);
    target.prepare("UPDATE agent_session_state SET main_session_id=? WHERE singleton_id=1").run(main_session_id);
    const table_transforms = {
      session_configuration: row => row,
      messages: row => {
        context.assert_fork?.(row, agent.agent_id);
        const recovered = interrupted.get(JSON.stringify([row.session_key, row.message_id]));
        return target_row(target, "messages", { ...(recovered?.message ?? row),
        origin_session_id: row.origin_session_id ? context.resolve(agent.agent_id, row.origin_session_id, undefined, row.origin_storage_id) : null,
        meta: convert_json(row.meta, value => rewrite_meta(value, context.resolve)),
      }); },
      message_parts: row => {
        const recovered = interrupted.get(JSON.stringify([row.session_key, row.message_id]))?.changed.get(row.part_id) ?? row;
        return { ...recovered, content: convert_json(recovered.content, value => convert_part(value, row.type, agent.agent_id, context)) };
      },
    };
    for (const [table, transform] of Object.entries(table_transforms)) {
      let insert;
      for (const row of source.prepare(`SELECT * FROM ${quote_identifier(table)} ORDER BY rowid`).iterate()) {
        const next = transform(row); insert ??= row_writer(target, table, next); insert(next);
      }
    }
    for (const recovered of interrupted.values()) row_writer(target, "message_parts", recovered.diagnostic)(recovered.diagnostic);
    // 派生摘要可能携带旧身份和 res_1 文本，原文留在强制备份中，由后续输入重新生成。
    const cleared_composer_checkpoints = source.prepare("SELECT count(*) AS count FROM composer_checkpoints").get().count;
    // 幂等请求和归档计划都采用了旧身份协议；仅存审计摘要，禁止当新协议 receipt 重放。
    const audit = new Map();
    for (const table of ["operation_receipts", "archive_operations", "archive_operation_nodes"]) {
      for (const row of source.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate()) {
        const prior = audit.get(row.operation_id) ?? [];
        prior.push({ table, sha256: digest(row) }); audit.set(row.operation_id, prior);
      }
    }
    const insert_audit = target.prepare("INSERT INTO legacy_operation_ids(operation_id,source_schema,audit_sha256) VALUES (?,8,?)");
    for (const [operation_id, rows] of audit) insert_audit.run(operation_id, digest(rows));
    for (const row of source.prepare("SELECT session_key,execution_profile FROM session_configuration WHERE execution_profile IS NOT NULL").iterate()) {
      const profile = JSON.parse(row.execution_profile);
      if (profile.creation_key) target.prepare("INSERT INTO session_creation_keys(category,creation_key,session_id) VALUES (?,?,?)")
        .run(by_key.get(row.session_key).category, profile.creation_key, by_key.get(row.session_key).session_id);
    }
    if (source.prepare("SELECT 1 FROM attachment_cleanup LIMIT 1").get()) fail("pending_attachment_cleanup");
    for (const trigger of triggers) target.exec(trigger.sql);
    target.exec("PRAGMA user_version=9;");
    validate_v9(target, agent.agent_id, runtime);
    target.exec("COMMIT;");
    return { sessions: by_key.size, main_session_id, cleared_composer_checkpoints,
      messages: target.prepare("SELECT count(*) AS count FROM messages").get().count,
      parts: target.prepare("SELECT count(*) AS count FROM message_parts").get().count };
  } finally { target.close(); }
}
