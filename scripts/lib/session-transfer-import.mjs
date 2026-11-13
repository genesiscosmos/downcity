/**
 * 单 Session 离线导入：原身份、同 Agent、冲突拒绝、附件先暂存、数据库事务最后提交。
 * 批次清单与原 operation_id 驱动重入；已提交通过同库 receipt 核对，不覆盖用户记录。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { digest, fail, check_integrity } from "./session-v7-database.mjs";
import { exists, ordinary, save_json, sync_path, attachment_inventory, copy_attachments } from "./session-v8-files.mjs";
import { agent_database, inventory, load_package, outside_root } from "./session-transfer-package.mjs";
import { read_record, insert_record, rebind_record, uuid_pattern } from "./session-transfer-record.mjs";
import { verify_sources } from "./session-transfer-sources.mjs";

/** 同一UUID、活动逻辑地址或待清理文件不能被导入接管；原receipt例外由调用方先核对。 */
function assert_available(database, metadata) {
  if (database.prepare("SELECT 1 FROM sessions WHERE storage_id=?").get(metadata.storage_id)) fail("transfer_storage_id_conflict");
  if (!metadata.archived && database.prepare("SELECT 1 FROM sessions WHERE category=? AND session_id=? AND archived=0").get(metadata.category, metadata.session_id)) fail("transfer_active_address_conflict");
  if (database.prepare("SELECT 1 FROM attachment_cleanup WHERE storage_id=?").get(metadata.storage_id)) fail("transfer_pending_cleanup_conflict");
  if (database.prepare("SELECT 1 FROM operation_receipts WHERE storage_id=? LIMIT 1").get(metadata.storage_id)
    || database.prepare("SELECT 1 FROM archive_operation_nodes WHERE storage_id=? LIMIT 1").get(metadata.storage_id)) fail("transfer_historical_identity_conflict");
}

/** 整个目标记录文件树必须与批次清单一致，原本存在的目录不会被当作暂存副本。 */
function verify_files(record_path, planned) {
  ordinary(record_path, true);
  if (fs.realpathSync(record_path) !== record_path) fail("unsafe_storage_path");
  if (fs.readdirSync(record_path).sort().join(",") !== ".owned-attachments.json,attachments") fail("transfer_target_files_conflict");
  const ownership_path = path.join(record_path, ".owned-attachments.json");
  ordinary(ownership_path);
  const ownership = JSON.parse(fs.readFileSync(ownership_path, "utf8"));
  const expected = { format_version: 1, agent_id: planned.agent_id, storage_id: planned.storage_id,
    files: planned.attachments.map(file => file.relative_path) };
  if (digest(ownership) !== digest(expected) || digest(attachment_inventory(path.join(record_path, "attachments"))) !== digest(planned.attachments)) fail("transfer_target_files_changed");
}

/** 启用与正式文件库相同的耐久设置；maintenance也必须设置业务写入边界。 */
function open_target(database_path, runtime, agent_id) {
  ordinary(database_path);
  const database = new DatabaseSync(database_path);
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=250;");
    if (process.platform === "darwin") database.exec("PRAGMA fullfsync=ON;");
    runtime.assert_agent_session_schema(database, agent_id);
    return database;
  } catch (error) { database.close(); throw error; }
}

/** 参数由CLI和此函数分别校验；没有默认根、自动改ID或隐式覆盖模式。 */
export async function import_session(input, runtime) {
  if (!input.writers_stopped || !input.root_path || !input.agent_id || !input.batch_path || !input.package_path
    || !uuid_pattern.test(input.operation_id ?? "")) fail("transfer_import_explicit_parameters_required");
  const root_path = fs.realpathSync(input.root_path);
  const batch_path = outside_root(root_path, input.batch_path, runtime);
  const package_path = path.resolve(input.package_path);
  if (package_path === root_path || package_path.startsWith(`${root_path}${path.sep}`)) fail("transfer_package_must_be_outside_root");
  if (batch_path === package_path || batch_path.startsWith(`${package_path}${path.sep}`)
    || package_path.startsWith(`${batch_path}${path.sep}`)) fail("transfer_batch_overlaps_package");
  const { manifest: package_manifest, record, fingerprint } = load_package(package_path, runtime);
  if (input.agent_id !== package_manifest.agent_id) fail("transfer_agent_identity_conflict");
  const storage_id = record.metadata.storage_id;
  const planned = { format_version: 1, operation_id: input.operation_id, root_path, agent_id: input.agent_id,
    storage_id, package_path, package_fingerprint: fingerprint, allow_unresolved_sources: input.allow_unresolved_sources === true,
    attachments: inventory(package_manifest.attachments) };
  const request_hash = digest(planned);
  const manifest_path = path.join(batch_path, "import.json");
  const root_lease = runtime.RootLease.acquire_write(root_path);
  let file_lease; let database;
  try {
    await runtime.assert_session_storage_ready(root_path);
    const database_path = agent_database(root_path, input.agent_id);
    file_lease = runtime.AgentSessionFileLease.acquire(database_path, input.agent_id, true);
    database = open_target(database_path, runtime, input.agent_id);
    let state;
    if (exists(batch_path)) {
      ordinary(batch_path, true); ordinary(manifest_path);
      state = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
      if (digest(state.planned) !== request_hash || state.request_hash !== request_hash
        || !["copying", "publishing", "files_published", "committed"].includes(state.status)) fail("transfer_import_batch_conflict");
    } else {
      assert_available(database, record.metadata);
      const final_path = path.join(path.dirname(database_path), "session-files", storage_id);
      if (exists(final_path)) fail("transfer_target_files_conflict");
      // 先检查来源，失败时不创建批次或发布附件。
      verify_sources(database, record, package_manifest.sources, runtime, planned.allow_unresolved_sources);
      fs.mkdirSync(batch_path, { mode: 0o700 });
      state = { planned, request_hash, status: "copying" }; save_json(manifest_path, state);
    }
    const save = status => { state = { planned, request_hash, status }; save_json(manifest_path, state, true); };
    const agent_path = path.dirname(database_path);
    const files_root = path.join(agent_path, "session-files");
    const final_path = path.join(files_root, storage_id);
    const stage_root = path.join(agent_path, ".session-imports");
    const stage_path = path.join(stage_root, input.operation_id);
    const stage_record = path.join(stage_path, "record");
    const receipt = database.prepare("SELECT * FROM operation_receipts WHERE operation_id=?").get(input.operation_id);
    if (receipt) {
      if (receipt.request_hash !== request_hash || receipt.storage_id !== storage_id) fail("transfer_operation_conflict");
      const result = JSON.parse(receipt.result);
      if (result.status !== "imported" || result.storage_id !== storage_id) fail("transfer_operation_conflict");
      verify_files(final_path, planned);
      const target = read_record(database, storage_id);
      if (digest(target) !== result.record_sha256) fail("transfer_imported_record_changed");
      save("committed");
      return { ...result, replayed: true };
    }
    if (state.status === "committed") fail("transfer_import_receipt_missing");
    assert_available(database, record.metadata);
    const unresolved = verify_sources(database, record, package_manifest.sources, runtime, planned.allow_unresolved_sources);
    for (const directory of [files_root, stage_root]) {
      if (!exists(directory)) { fs.mkdirSync(directory, { mode: 0o700 }); sync_path(agent_path); }
      ordinary(directory, true);
      if (fs.realpathSync(directory) !== directory) fail("unsafe_storage_path");
    }
    if (state.status === "copying") {
      if (exists(final_path)) fail("transfer_target_files_conflict");
      if (!exists(stage_path)) { fs.mkdirSync(stage_path, { mode: 0o700 }); save_json(path.join(stage_path, "owner.json"), { operation_id: input.operation_id, request_hash }); }
      ordinary(stage_path, true); ordinary(path.join(stage_path, "owner.json"));
      if (digest(JSON.parse(fs.readFileSync(path.join(stage_path, "owner.json"), "utf8"))) !== digest({ operation_id: input.operation_id, request_hash })) fail("transfer_stage_conflict");
      if (!exists(stage_record)) fs.mkdirSync(stage_record, { mode: 0o700 });
      copy_attachments(path.join(package_path, "attachments"), path.join(stage_record, "attachments"), planned.attachments);
      const ownership = { format_version: 1, agent_id: input.agent_id, storage_id,
        files: planned.attachments.map(file => file.relative_path) };
      const ownership_path = path.join(stage_record, ".owned-attachments.json");
      if (!exists(ownership_path)) save_json(ownership_path, ownership);
      // 复制工作区不属于最终记录；只允许移除已为空的私有复制区。
      const copies = path.join(stage_record, ".session-migration-copies");
      if (exists(copies)) { ordinary(copies, true); if (fs.readdirSync(copies).length) fail("transfer_stage_incomplete"); fs.rmdirSync(copies); }
      verify_files(stage_record, planned); sync_path(stage_record);
      save("publishing");
    }
    if (state.status === "publishing") {
      // rename后清单写入前崩溃：只接受本批已校验的完整目标，绝不接管新批次外文件。
      if (exists(final_path)) { if (exists(stage_record)) fail("transfer_target_files_conflict"); verify_files(final_path, planned); }
      else { verify_files(stage_record, planned); fs.renameSync(stage_record, final_path); sync_path(stage_path); sync_path(files_root); }
      save("files_published");
    }
    verify_files(final_path, planned);
    if (load_package(package_path, runtime).fingerprint !== fingerprint) fail("transfer_package_changed_during_import");
    const files = package_manifest.attachments.map(file => ({ ...file,
      target_media_version: runtime.file_read_version(fs.statSync(path.join(final_path, "attachments", file.relative_path))) }));
    const rebound = rebind_record(record, package_manifest.source_attachments, path.join(final_path, "attachments"), files,
      { ...runtime, agent_id: input.agent_id });
    const result = { status: "imported", storage_id, unresolved_sources: unresolved.length, record_sha256: digest(rebound) };
    database.exec("BEGIN IMMEDIATE;");
    try {
      assert_available(database, rebound.metadata);
      verify_sources(database, rebound, package_manifest.sources, runtime, planned.allow_unresolved_sources);
      insert_record(database, rebound); check_integrity(database);
      if (digest(read_record(database, storage_id)) !== result.record_sha256) fail("transfer_semantic_mismatch");
      const now = Date.now();
      database.prepare("UPDATE storage_metadata SET first_business_write_at=COALESCE(first_business_write_at,?) WHERE singleton_id=1").run(now);
      database.prepare("INSERT INTO operation_receipts(operation_id,request_hash,storage_id,result,committed_at) VALUES(?,?,?,?,?)")
        .run(input.operation_id, request_hash, storage_id, JSON.stringify(result), now);
      database.exec("COMMIT;");
    } catch (error) { try { database.exec("ROLLBACK;"); } catch {} throw error; }
    save("committed");
    return { ...result, replayed: false };
  } finally { database?.close(); file_lease?.release(); root_lease.release(); }
}
