/** 独立版本化单Session目录包；持源读/附件租约直至最后副本校验，不依赖在线布局副本。 */
import { assert_transfer_runtime, transfer_schema_version, transfer_package_version } from "./session-transfer-protocol.mjs";
import { assert_attachment_owner, assert_no_pending_archive, assert_operation, assert_transfer_database } from "./session-transfer-guards.mjs";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { digest, fail, check_integrity } from "./session-v7-database.mjs";
import { exists, ordinary, attachment_inventory, copy_attachments, save_json } from "./session-v8-files.mjs";
import { read_record, validate_record, validate_protocol_record, rebind_record, uuid_pattern } from "./session-transfer-record.mjs";
import { record_sources, verify_sources } from "./session-transfer-sources.mjs";

export const inventory = files => files.map(({ relative_path, bytes, sha256 }) => ({ relative_path, bytes, sha256 }));

/** 包操作摘要绑定全部不可变字段，发布状态和摘要自身不参与哈希。 */
export function package_request_hash(manifest) {
  const { status: _status, request_hash: _request_hash, ...identity } = manifest;
  return digest(identity);
}

/** 显式输出路径不允许留在业务根内部，避免包/导入现场变成源扫描的一部分。 */
export function outside_root(root_path, output, runtime) {
  const target = runtime.resolve_resource_root(output);
  if (target === root_path || target.startsWith(`${root_path}${path.sep}`) || root_path.startsWith(`${target}${path.sep}`)) fail("transfer_package_must_be_outside_root");
  return target;
}

/** Agent目录和业务库必须已存在；数据库拥有者另行校验，不由转移工具创建身份。 */
export function agent_database(root_path, agent_id) {
  if (typeof agent_id !== "string" || !agent_id || agent_id.trim() !== agent_id || /[\\/\0]/u.test(agent_id) || [".", ".."].includes(agent_id)) fail("transfer_agent_invalid");
  const agent_path = path.join(root_path, "agents", agent_id);
  ordinary(agent_path, true);
  if (fs.realpathSync(agent_path) !== agent_path) fail("unsafe_storage_path");
  const database_path = path.join(agent_path, "sessions.db"); ordinary(database_path);
  return database_path;
}

/** 单记录导出可同原operation_id重入；已有无归属目录不会接管或覆盖。 */
export async function export_session(input, runtime) {
  assert_transfer_runtime(runtime);
  if (!input.writers_stopped || !input.root_path || !input.agent_id || !input.package_path) fail("transfer_explicit_root_agent_and_stopped_required");
  const root_path = fs.realpathSync(input.root_path);
  const package_path = outside_root(root_path, input.package_path, runtime);
  if (!uuid_pattern.test(input.session_id ?? "") || !uuid_pattern.test(input.operation_id ?? "")) fail("transfer_operation_identity_invalid");
  const root_lease = runtime.RootLease.acquire_write(root_path);
  let database; let file_lease;
  try {
    await runtime.assert_session_storage_ready(root_path);
    const database_path = agent_database(root_path, input.agent_id);
    file_lease = runtime.AgentSessionFileLease.acquire(database_path, input.agent_id);
    database = new DatabaseSync(database_path, { readOnly: true });
    assert_transfer_database(database, input.agent_id, runtime);
    database.exec("PRAGMA query_only=ON; BEGIN;"); check_integrity(database);
    const record = read_record(database, input.session_id); validate_record(record, input.agent_id, runtime);
    assert_operation(database, input.operation_id);
    assert_no_pending_archive(database, input.session_id);
    const source_attachments = path.join(path.dirname(database_path), "session-files", input.session_id, "attachments");
    for (const directory of [path.dirname(path.dirname(source_attachments)), path.dirname(source_attachments), source_attachments]) {
      if (exists(directory)) { ordinary(directory, true); if (fs.realpathSync(directory) !== directory) fail("unsafe_storage_path"); }
    }
    const attachments = attachment_inventory(source_attachments).map(file => ({ ...file,
      source_media_version: runtime.file_read_version(fs.statSync(path.join(source_attachments, file.relative_path))) }));
    // 转换验证确保本Session内引用的所属附件确实在清单中；不修改导出的原始正文。
    rebind_record(record, source_attachments, source_attachments, attachments, { ...runtime, agent_id: input.agent_id });
    assert_attachment_owner(path.dirname(source_attachments), input.agent_id, input.session_id, attachments);
    const source_runtime = { ...runtime, agent_id: input.agent_id };
    const sources = record_sources(record, source_runtime);
    const unresolved = verify_sources(database, record, sources, source_runtime, input.allow_unresolved_sources === true);
    const planned = { format_version: transfer_package_version, schema_version: transfer_schema_version, agent_id: input.agent_id, session_id: input.session_id,
      allow_unresolved_sources: input.allow_unresolved_sources === true,
      export_operation_id: input.operation_id, source_attachments, record_sha256: digest(record), attachments, sources, status: "copying" };
    planned.request_hash = package_request_hash(planned);
    const manifest_path = path.join(package_path, "manifest.json");
    if (exists(package_path)) {
      ordinary(package_path, true); ordinary(manifest_path);
      const saved = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
      if (digest({ ...saved, status: "copying" }) !== digest(planned)) fail("transfer_export_conflict_or_source_changed");
      if (saved.status === "ready") { load_package(package_path, runtime); return { status: "exported", session_id: input.session_id, package_path, unresolved_sources: unresolved.length }; }
      if (saved.status !== "copying") fail("transfer_package_invalid");
    } else {
      fs.mkdirSync(package_path, { mode: 0o700 }); save_json(manifest_path, planned);
    }
    const record_path = path.join(package_path, "record.json");
    if (exists(record_path)) {
      ordinary(record_path); if (digest(JSON.parse(fs.readFileSync(record_path, "utf8"))) !== planned.record_sha256) fail("transfer_package_record_changed");
    } else save_json(record_path, record);
    copy_attachments(source_attachments, path.join(package_path, "attachments"), inventory(attachments));
    if (digest(attachment_inventory(source_attachments)) !== digest(inventory(attachments))) fail("transfer_source_attachments_changed");
    assert_attachment_owner(path.dirname(source_attachments), input.agent_id, input.session_id, attachments);
    save_json(manifest_path, { ...planned, status: "ready" }, true);
    load_package(package_path, runtime);
    return { status: "exported", session_id: input.session_id, package_path, unresolved_sources: unresolved.length };
  } finally { database?.close(); file_lease?.release(); root_lease.release(); }
}

/** 校验独立包的全部内容，拒绝额外文件、链接、路径逃逸和变更；不读取source_attachments路径。 */
export function load_package(package_path, runtime) {
  assert_transfer_runtime(runtime);
  return load_protocol_package(package_path, runtime);
}

/** 显式历史转换共用文件/摘要校验；正式入口始终先拒绝非当前 runtime。 */
export function load_protocol_package(package_path, runtime) {
  const directory_stat = ordinary(package_path, true);
  if (directory_stat.mode & 0o077) fail("transfer_package_permissions_or_budget");
  if (fs.realpathSync(package_path) !== path.resolve(package_path)) fail("unsafe_storage_path");
  for (const name of fs.readdirSync(package_path)) if (!["manifest.json", "record.json", "attachments", ".session-migration-copies"].includes(name)) fail("transfer_package_unknown_files");
  const manifest_path = path.join(package_path, "manifest.json"); const record_path = path.join(package_path, "record.json");
  for (const file of [manifest_path, record_path]) {
    const stat = ordinary(file); if ((stat.mode & 0o077) || stat.size > 256 * 1024 * 1024) fail("transfer_package_permissions_or_budget");
  }
  const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
  const record = JSON.parse(fs.readFileSync(record_path, "utf8"));
  if (manifest.format_version === 1 || (manifest.format_version === 2 && manifest.schema_version === 9)
    || (runtime.AGENT_SESSION_SCHEMA_VERSION === transfer_schema_version && manifest.schema_version === 10)) fail("transfer_legacy_package_requires_conversion");
  if (Object.keys(manifest).sort().join(",") !== "agent_id,allow_unresolved_sources,attachments,export_operation_id,format_version,record_sha256,request_hash,schema_version,session_id,source_attachments,sources,status"
    || manifest.format_version !== transfer_package_version || manifest.schema_version !== runtime.AGENT_SESSION_SCHEMA_VERSION || manifest.status !== "ready" || !uuid_pattern.test(manifest.export_operation_id ?? "")
    || !uuid_pattern.test(manifest.session_id ?? "") || manifest.session_id !== record.metadata?.session_id || typeof manifest.source_attachments !== "string"
    || typeof manifest.allow_unresolved_sources !== "boolean"
    || !path.isAbsolute(manifest.source_attachments) || !Array.isArray(manifest.attachments) || !Array.isArray(manifest.sources)
    || manifest.request_hash !== package_request_hash(manifest) || manifest.record_sha256 !== digest(record)) fail("transfer_package_invalid");
  const copies_path = path.join(package_path, ".session-migration-copies");
  if (exists(copies_path)) { ordinary(copies_path, true); if (fs.readdirSync(copies_path).length) fail("transfer_package_unknown_files"); }
  validate_protocol_record(record, manifest.agent_id, runtime);
  const files = attachment_inventory(path.join(package_path, "attachments"));
  if (digest(files) !== digest(inventory(manifest.attachments))) fail("transfer_package_attachments_changed");
  for (const file of manifest.attachments) if (Object.keys(file).sort().join(",") !== "bytes,relative_path,sha256,source_media_version" || typeof file.source_media_version !== "string") fail("transfer_package_invalid");
  if (digest(record_sources(record, { ...runtime, agent_id: manifest.agent_id })) !== digest(manifest.sources)) fail("transfer_package_sources_changed");
  rebind_record(record, manifest.source_attachments, manifest.source_attachments, manifest.attachments, { ...runtime, agent_id: manifest.agent_id });
  return { manifest, record, fingerprint: digest(manifest) };
}
