/**
 * v5/v6/v7 分库到 v8 Agent 单库的纯规划和完整校验。
 * 旧 codec 只验证正文；fork 来源随后从全 Agent 的完整消息身份唯一解析。
 * v5/v6 复用既有显式转换，保留原始 canonical 内容与稳定水位，不猜测模型或来源。
 */
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomBytes as random_bytes, randomUUID as random_uuid } from "node:crypto";
import { fileURLToPath as file_url_to_path } from "node:url";
import { digest, fail, snapshot_file, target_descriptor, validate_source_structure, group_parts_by_message, check_integrity } from "./session-v7-database.mjs";
import { plan_snapshot } from "./session-v7-plan.mjs";
import { attachment_inventory, inside, source_database_path } from "./session-v8-files.mjs";

/** 本地文件引用必须属于该 Session；远程 URL 与 data URL 保留其原语义。 */
function rewrite_file(content, source, root_path, attachments) {
  const rewrite = item => {
    const url = item.url;
    if (typeof url !== "string") fail("attachment_url_invalid");
    if (/^(https?:|data:)/iu.test(url)) return item;
    // Workspace 引用不由 Session 持有，保持原地址和运行时权限，不复制或读取外部正文。
    if (!path.isAbsolute(url) && !url.startsWith("file:") && !url.startsWith("attachments/")) return item;
    const logical_directory = path.dirname(inside(root_path, source.relative_path));
    const file_path = url.startsWith("file:") ? file_url_to_path(url) : path.resolve(logical_directory, url);
    // recovered库的正文可引用保留副本绝对路径；两种原地址均只在本来源完整附件清单内重绑。
    const source_directories = [logical_directory, path.dirname(source_database_path(root_path, source))];
    const relative_path = source_directories.map(directory => path.relative(path.join(directory, "attachments"), file_path))
      .find(relative => relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    if (!relative_path) {
      // 其他 Session、Workspace 或已删除路径不属于当前迁移的附件所有权，保留原引用。
      // 只有当前 Session attachments/ 下的文件才复制并重写路径。
      return item;
    }
    if (!attachments.some(attachment => attachment.relative_path === relative_path)) fail("attachment_missing");
    const disclosed = item.media_version && item.media_version === source.media_versions?.[relative_path];
    return { ...item, url: path.join(root_path, "agents", source.agent_id, "session-files", source.storage_id, "attachments", relative_path),
      ...(disclosed && source.target_media_versions?.[relative_path] ? { media_version: source.target_media_versions[relative_path] } : {}) };
  };
  if (source.part_type === "file") return rewrite(content);
  if (source.part_type === "inbox") {
    const items = content.content.map(item => item.type === "file" ? rewrite(item) : item);
    for (const [index, item] of items.entries()) {
      if (item.type === "context") items[index] = rewrite_path_context(item, content.content[index - 1], items[index - 1]);
    }
    return { ...content, content: items };
  }
  return content;
}

/** 仅重写框架生成且紧跟所属附件的路径提示，正文中的任意相似字符串保持原样。 */
function rewrite_path_context(context, before, after) {
  if (context.tag !== "attachment_path" || before?.type !== "file" || after?.type !== "file") return context;
  const prefix = `对应${before.media_type.startsWith("image/") ? "图片" : "附件"}路径：`;
  return context.context === `${prefix}${before.url}` ? { ...context, context: `${prefix}${after.url}` } : context;
}

/** 旧格式没有持久化 archive 时间；明确以源 updated_at 作迁移基准并在报告注明。 */
function configuration_rows(state, tables) {
  const binding = tables.session_model_binding?.[0]?.binding ?? null;
  const profile = tables.session_execution_profile?.[0]?.reference ?? null;
  return { model_binding: binding, approval_mode: state.approval_mode, execution_profile: profile, system_snapshot: state.system_snapshot };
}

/** 构造一个 Agent 的候选数据；不写文件，不修改源 snapshot。 */
export function plan_agent(root_path, agent, runtime, repairs = new Map(), source_root = root_path) {
  const expected = target_descriptor(runtime);
  // 只移除旧 envelope 的 fork 字段来验证消息正文；关联从未进入目标前被下面的唯一匹配替代。
  const legacy_runtime = { ...runtime, decode_session_message: (row, parts, session_id) => runtime.decode_session_message(
    { ...row, origin_session_id: null, origin_message_id: null, origin_turn_id: null }, parts, session_id) };
  const records = [];
  const blockers = [];
  for (const source of agent.sources) {
    try {
    const snapshot = snapshot_file(source_database_path(root_path, source, source_root));
    validate_source_structure(snapshot, expected);
    if (snapshot.version === 7) {
      const normalize = sql => sql.replace(/\bIF NOT EXISTS\b/gi, "").replace(/\s+/g, " ").trim();
      for (const item of expected.schema) {
        const actual = snapshot.schema.find(candidate => candidate.type === item.type && candidate.name === item.name);
        if (!actual || normalize(actual.sql) !== normalize(item.sql)) fail("source_v7_schema_definition_mismatch");
      }
    }
    if (source.source_fingerprint && snapshot.fingerprint !== source.source_fingerprint) fail("source_changed_since_preflight");
    const conversion = plan_snapshot(snapshot, source, legacy_runtime, expected, repairs.get(source.relative_path));
    const tables = conversion?.tables ?? snapshot.tables;
    const state = tables.session_state[0];
    if (state.singleton_id !== 1 || ["session_model_binding", "session_execution_profile"].some(name =>
      (tables[name]?.length ?? 0) > 1 || tables[name]?.some(row => row.singleton_id !== 1))) fail("source_configuration_identity_invalid");
    let origin;
    try {
      const persisted_origin = JSON.parse(state.origin);
      if (persisted_origin.category !== undefined && persisted_origin.category !== source.category) fail("source_origin_category_mismatch");
      origin = runtime.restore_session_origin({ ...persisted_origin, category: source.category }, source.category);
    }
    catch { fail("source_origin_category_mismatch"); }
    if (origin.category !== source.category) fail("source_origin_category_mismatch");
    if (!state.timezone?.trim() || !state.session_id?.trim() || !state.agent_id?.trim()) fail("source_identity_invalid");
    const attachments = attachment_inventory(path.join(path.dirname(source_database_path(root_path, source, source_root)), "attachments"));
    if (source.attachments && digest(source.attachments) !== digest(attachments)) fail("attachments_changed");
    const media_versions = source.media_versions ?? Object.fromEntries(attachments.map(item => [item.relative_path,
      runtime.file_read_version(fs.statSync(inside(path.join(path.dirname(source_database_path(root_path, source)), "attachments"), item.relative_path)))]));
    const watermark_map = new Map(conversion?.watermarks ?? []);
    const messages = tables.messages.map(row => ({ ...row, stable_part_sequence: watermark_map.get(row.message_id) ?? row.stable_part_sequence, origin_storage_id: null }));
    const parts = tables.message_parts.map(part => {
      if (!["file", "inbox"].includes(part.type)) return { ...part };
      const before = JSON.parse(part.content);
      const after = rewrite_file(before, { ...source, media_versions, part_type: part.type }, root_path, attachments);
      return { ...part, content: digest(before) === digest(after) ? part.content : JSON.stringify(after) };
    });
    const grouped_source = group_parts_by_message(tables.message_parts);
    const grouped_target = group_parts_by_message(parts);
    for (const [message_id, target_parts] of grouped_target) {
      const source_parts = grouped_source.get(message_id);
      for (const [index, part] of target_parts.entries()) {
        if (part.type !== "context" || index === 0) continue;
        const previous_source = source_parts[index - 1]; const previous_target = target_parts[index - 1];
        const before = JSON.parse(part.content);
        const after = rewrite_path_context(before, { type: previous_source.type, ...JSON.parse(previous_source.content) }, { type: previous_target.type, ...JSON.parse(previous_target.content) });
        if (digest(before) !== digest(after)) part.content = JSON.stringify(after);
      }
    }
    const configuration = configuration_rows(state, tables);
    if (configuration.model_binding) {
      try { runtime.decode_model_binding(configuration.model_binding); }
      catch { fail("source_model_binding_invalid"); }
    }
    if (configuration.execution_profile) {
      const profile = JSON.parse(configuration.execution_profile);
      if (!profile || typeof profile !== "object" || Array.isArray(profile) || typeof profile.id !== "string" || !profile.id.trim()
        || !Number.isSafeInteger(profile.version) || profile.version < 1 || typeof profile.model_id !== "string" || !profile.model_id.trim()
        || (profile.creation_key !== undefined && (typeof profile.creation_key !== "string" || !profile.creation_key.trim()))) fail("source_execution_profile_invalid");
    }
    records.push({ source, state, origin, messages, parts, configuration, attachments, media_versions, source_fingerprint: snapshot.fingerprint,
      conversion: conversion?.manifest ?? null,
      derived_tables: Object.keys(snapshot.tables).filter(name => name.startsWith("composer_")) });
    } catch (error) {
      blockers.push({ relative_path: source.relative_path, reason: error.migration_code ?? "operation_failed_details_redacted" });
    }
  }
  if (blockers.length) {
    const error = new Error(blockers[0].reason);
    error.migration_code = blockers[0].reason; error.source_relative_path = blockers[0].relative_path; error.source_blockers = blockers;
    throw error;
  }
  const addresses = new Set();
  const source_messages = new Map();
  for (const record of records) {
    if (record.source.partition === "sessions") {
      const address = `${record.origin.category}\0${record.state.session_id}`;
      if (addresses.has(address)) fail("duplicate_active_session_identity");
      addresses.add(address);
    }
    for (const message of record.messages) {
      const key = `${record.state.session_id}\0${message.message_id}`;
      const matches = source_messages.get(key) ?? [];
      matches.push({ record, message }); source_messages.set(key, matches);
    }
  }
  for (const record of records) {
    const grouped = group_parts_by_message(record.parts);
    for (const message of record.messages) {
      try {
      if (Boolean(message.origin_session_id) !== Boolean(message.origin_message_id) || (message.origin_turn_id && !message.origin_session_id)) fail("incomplete_fork_origin");
      if (message.origin_session_id) {
        const matches = (source_messages.get(`${message.origin_session_id}\0${message.origin_message_id}`) ?? [])
          .filter(candidate => !message.origin_turn_id || candidate.message.turn_id === message.origin_turn_id);
        if (matches.length !== 1) fail(matches.length ? "fork_origin_ambiguous" : "fork_origin_missing");
        message.origin_storage_id = matches[0].record.source.storage_id;
      }
      const parts = grouped.get(message.message_id) ?? [];
      if (parts.some((part, index) => part.sequence !== index + 1)) fail("non_contiguous_part_sequence");
      let decoded;
      try { decoded = runtime.decode_session_message(message, parts, record.state.session_id); }
      catch { fail("target_codec_rejected_content"); }
      if (decoded.role === "agent" && message.stable_part_sequence > runtime.resolve_stable_part_sequence(decoded.parts, 0)) fail("stable_prefix_crosses_step_boundary");
      } catch (error) {
        blockers.push({ relative_path: record.source.relative_path, message_id: message.message_id, reason: error.migration_code ?? "operation_failed_details_redacted" });
      }
    }
    if (record.state.message_count !== record.messages.length) blockers.push({ relative_path: record.source.relative_path, reason: "source_message_count_mismatch" });
  }
  if (blockers.length) {
    const error = new Error(blockers[0].reason);
    error.migration_code = blockers[0].reason; error.source_relative_path = blockers[0].relative_path; error.source_blockers = blockers;
    throw error;
  }
  return records;
}

/** 以绑定参数插入完整 row，不重序列化无变更的正文。 */
function insert(database, table, row) {
  const names = Object.keys(row);
  database.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(row));
}

/** 暂存库和内存预检使用同一事务导入路径，稳定水位必须在 Parts 导入后恢复。 */
export function import_agent(database, agent_id, records, runtime) {
  database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;");
  try {
    database.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
    database.prepare("INSERT INTO storage_metadata VALUES (1, ?, 8, ?, ?, ?, NULL)")
      .run(agent_id, random_uuid(), random_bytes(32), Date.now());
    for (const [index, record] of records.entries()) {
      const { state, source } = record;
      const session_key = index + 1;
      const last = record.messages.toSorted((left, right) => left.sequence - right.sequence).at(-1);
      const preview = last ? runtime.resolve_session_message_preview(runtime.decode_session_message(last, record.parts.filter(part => part.message_id === last.message_id), state.session_id)).trim().slice(0, 180) || null : null;
      insert(database, "sessions", { session_key, storage_id: source.storage_id, session_id: state.session_id, category: record.origin.category,
        origin: JSON.stringify(record.origin), workspace_id: state.workspace_id, timezone: state.timezone, title: state.title, model_label: state.model_label,
        archived: source.partition === "archived-sessions" ? 1 : 0, archived_at: source.partition === "archived-sessions" ? state.updated_at : null,
        message_count: record.messages.length, preview_text: preview, revision: state.revision, created_at: state.created_at, updated_at: state.updated_at });
      const config = record.configuration;
      database.prepare("UPDATE session_configuration SET model_binding=?, approval_mode=?, execution_profile=?, system_snapshot=? WHERE session_key=?")
        .run(config.model_binding, config.approval_mode, config.execution_profile, config.system_snapshot, session_key);
      for (const row of record.messages) insert(database, "messages", { session_key, ...row, stable_part_sequence: 0 });
      for (const row of record.parts) insert(database, "message_parts", { session_key, ...row });
      for (const row of record.messages) if (row.stable_part_sequence) database.prepare("UPDATE messages SET stable_part_sequence=? WHERE session_key=? AND message_id=?").run(row.stable_part_sequence, session_key, row.message_id);
    }
    database.exec("PRAGMA user_version = 8;");
    verify_agent(database, agent_id, records, runtime);
    database.exec("COMMIT;");
  } catch (error) { database.exec("ROLLBACK;"); throw error; }
}

/** 不仅比较数量：逐条验证身份、消息/Part 完整 row、配置、约束与 codec。 */
export function verify_agent(database, agent_id, records, runtime) {
  check_integrity(database);
  runtime.assert_agent_session_schema(database, agent_id);
  const sessions = database.prepare("SELECT * FROM sessions ORDER BY session_key").all();
  if (sessions.length !== records.length) fail("target_session_count_mismatch");
  for (const [index, record] of records.entries()) {
    const row = sessions[index];
    if (row.storage_id !== record.source.storage_id || row.session_id !== record.state.session_id || row.category !== record.origin.category
      || row.origin !== JSON.stringify(record.origin) || row.archived !== Number(record.source.partition === "archived-sessions")
      || ["workspace_id", "timezone", "title", "model_label", "revision", "created_at", "updated_at"].some(name => row[name] !== record.state[name])
      || row.message_count !== record.messages.length || row.archived_at !== (row.archived ? record.state.updated_at : null)) fail("target_metadata_mismatch");
    const messages = database.prepare("SELECT * FROM messages WHERE session_key=? ORDER BY sequence").all(row.session_key).map(({ session_key, ...message }) => message);
    const parts = database.prepare("SELECT * FROM message_parts WHERE session_key=? ORDER BY part_id").all(row.session_key).map(({ session_key, ...part }) => part);
    const { session_key, ...config } = database.prepare("SELECT * FROM session_configuration WHERE session_key=?").get(row.session_key);
    if (digest(messages) !== digest(record.messages.toSorted((left, right) => left.sequence - right.sequence)) || digest(parts) !== digest(record.parts.toSorted((left, right) => Buffer.compare(Buffer.from(left.part_id), Buffer.from(right.part_id))))
      || digest(config) !== digest(record.configuration)) fail("target_content_mismatch");
  }
}

/** 预检执行真实 schema 和全部约束；候选正文不进入报告。 */
export function validate_agent(agent_id, records, runtime) {
  const database = new DatabaseSync(":memory:");
  try { import_agent(database, agent_id, records, runtime); }
  finally { database.close(); }
}
