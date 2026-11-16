/**
 * format 1/schema 8 包的隔离离线转换器，只接受可由单包完整证明的来源。
 * 固定 v8 DDL 重建临时源，复用正式 v9 身份/结果转换，绝不访问 manifest 中的源路径。
 * 跨记录来源缺少 canonical 证据时拒绝，需先完成受审阅的全根迁移；不生成运行时 alias。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID as random_uuid, randomBytes as random_bytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { digest, fail } from "./session-v7-database.mjs";
import { attachment_inventory, copy_attachments, exists, ordinary, save_json } from "./session-v8-files.mjs";
import { v8_schema, open_source } from "./session-v9-database.mjs";
import { create_resolver, identity_rows, uuid_pattern } from "./session-v9-identities.mjs";
import { convert_database } from "./session-v9-conversion.mjs";
import { create_result_rewriter } from "./session-v9-results.mjs";
import { read_record, validate_record } from "./session-v9-transfer-record.mjs";
import { inventory, load_package, package_request_hash } from "./session-v9-transfer-package.mjs";
import { record_sources } from "./session-transfer-sources.mjs";

/** 包提供的字段只作为值；列集必须精确匹配固定协议，不允许注入 SQL 或内部键。 */
function insert_row(database, table, row, session_key = undefined) {
  if (!row || Object.hasOwn(row, "session_key")) fail("transfer_legacy_record_invalid");
  const expected = database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name).filter(name => name !== "session_key");
  if (Object.keys(row).sort().join(",") !== expected.sort().join(",")) fail("transfer_legacy_record_invalid");
  const value = { ...row, ...(session_key === undefined ? {} : { session_key }) };
  const names = Object.keys(value);
  database.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(value));
}

/** 显式生成新 format 2 包；源包保持原样，未知外部来源阻断且不接受猜测映射。 */
export function convert_v8_package(input, runtime) {
  if (!input.package_path || !input.output_path || !uuid_pattern.test(input.operation_id ?? "")) fail("transfer_legacy_explicit_parameters_required");
  const source_path = fs.realpathSync(input.package_path);
  if (ordinary(source_path, true).mode & 0o077) fail("transfer_package_permissions_or_budget");
  const output_path = runtime.resolve_resource_root(input.output_path);
  if (output_path === source_path || output_path.startsWith(`${source_path}${path.sep}`) || source_path.startsWith(`${output_path}${path.sep}`)) fail("transfer_package_overlap");
  if (exists(output_path)) fail("output_already_exists");
  for (const name of fs.readdirSync(source_path)) if (!["manifest.json", "record.json", "attachments", ".session-migration-copies"].includes(name)) fail("transfer_package_unknown_files");
  const read_json = name => {
    const file = path.join(source_path, name); const stat = ordinary(file);
    if ((stat.mode & 0o077) || stat.size > 256 * 1024 * 1024) fail("transfer_package_permissions_or_budget");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  };
  const manifest = read_json("manifest.json"); const record = read_json("record.json");
  if (Object.keys(manifest).sort().join(",") !== "agent_id,attachments,export_operation_id,format_version,record_sha256,schema_version,source_attachments,sources,status,storage_id"
    || manifest.format_version !== 1 || manifest.schema_version !== 8 || manifest.status !== "ready"
    || !uuid_pattern.test(manifest.storage_id ?? "") || !uuid_pattern.test(manifest.export_operation_id ?? "")
    || manifest.storage_id !== record.metadata?.storage_id || manifest.record_sha256 !== digest(record)
    || typeof manifest.agent_id !== "string" || !manifest.agent_id || /[\\/\0]/u.test(manifest.agent_id) || [".", ".."].includes(manifest.agent_id)
    || typeof manifest.source_attachments !== "string" || !path.isAbsolute(manifest.source_attachments)
    || !Array.isArray(manifest.attachments) || !Array.isArray(manifest.sources)
    || Object.keys(record).sort().join(",") !== "composer_checkpoints,configuration,message_parts,messages,metadata") fail("transfer_legacy_package_invalid");
  if (digest(attachment_inventory(path.join(source_path, "attachments"))) !== digest(inventory(manifest.attachments))) fail("transfer_package_attachments_changed");
  const copies = path.join(source_path, ".session-migration-copies");
  if (exists(copies)) { ordinary(copies, true); if (fs.readdirSync(copies).length) fail("transfer_package_unknown_files"); }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-transfer-convert-"));
  let rewriter;
  try {
    const agent_path = path.join(temporary, "agents", manifest.agent_id); fs.mkdirSync(agent_path, { recursive: true });
    const database_path = path.join(agent_path, "sessions.db");
    const database = new DatabaseSync(database_path);
    try {
      database.exec("PRAGMA foreign_keys=ON; BEGIN;"); database.exec(v8_schema);
      database.prepare("INSERT INTO storage_metadata VALUES(1,?,8,?,?,1,NULL)").run(manifest.agent_id, random_uuid(), random_bytes(32));
      insert_row(database, "sessions", record.metadata, 1);
      database.prepare("DELETE FROM session_configuration WHERE session_key=1").run();
      insert_row(database, "session_configuration", record.configuration, 1);
      for (const row of record.messages) insert_row(database, "messages", { ...row, stable_part_sequence: 0 }, 1);
      for (const row of record.message_parts) insert_row(database, "message_parts", row, 1);
      for (const row of record.messages) database.prepare("UPDATE messages SET stable_part_sequence=? WHERE session_key=1 AND message_id=?").run(row.stable_part_sequence, row.message_id);
      for (const row of record.composer_checkpoints) insert_row(database, "composer_checkpoints", row, 1);
      database.exec("PRAGMA user_version=8; COMMIT;");
    } finally { database.close(); }
    const source = open_source(database_path);
    const target_path = path.join(temporary, "converted.db");
    try {
      const agent = { agent_id: manifest.agent_id, identities: identity_rows(source, manifest.agent_id) };
      const context = { root_path: temporary, agents: [agent], resolve: create_resolver([agent]) };
      rewriter = create_result_rewriter(context, runtime); context.rewrite_reference = rewriter.rewrite; context.assert_fork = rewriter.assert_fork;
      convert_database(source, agent, context, runtime, target_path);
    } finally { source.close(); rewriter?.close(); rewriter = undefined; }
    const target = new DatabaseSync(target_path, { readOnly: true });
    let converted;
    try { converted = read_record(target, manifest.storage_id); } finally { target.close(); }
    validate_record(converted, manifest.agent_id, runtime);
    const sources = record_sources(converted, { ...runtime, agent_id: manifest.agent_id });
    // 转换器不携带其他记录证据，绝不声称外部来源已经验证。
    if (sources.some(source => source.session_id !== manifest.storage_id || source.agent_id !== manifest.agent_id)) fail("transfer_legacy_external_sources_require_root_conversion");
    const planned = { format_version: 2, schema_version: 9, agent_id: manifest.agent_id, session_id: manifest.storage_id,
      allow_unresolved_sources: false, export_operation_id: input.operation_id, source_attachments: manifest.source_attachments,
      record_sha256: digest(converted), attachments: manifest.attachments, sources, status: "copying" };
    planned.request_hash = package_request_hash(planned);
    fs.mkdirSync(output_path, { mode: 0o700 }); save_json(path.join(output_path, "manifest.json"), planned);
    save_json(path.join(output_path, "record.json"), converted);
    copy_attachments(path.join(source_path, "attachments"), path.join(output_path, "attachments"), inventory(manifest.attachments));
    save_json(path.join(output_path, "manifest.json"), { ...planned, status: "ready" }, true);
    load_package(output_path, runtime);
    return { status: "converted", session_id: manifest.storage_id, cleared_composer_checkpoints: record.composer_checkpoints.length };
  } finally { rewriter?.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
}
