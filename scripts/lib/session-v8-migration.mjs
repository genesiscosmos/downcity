/**
 * v8 离线迁移批次拥有者：独占租约、WAL 一致性备份、暂存、逐 Agent 发布与根完成标记。
 * 源库和原附件始终保留；重入校验完整源/目标指纹，开始业务写入的目标不能恢复或覆盖。
 */
import { assert_v8_runtime } from "./session-v8-runtime-gate.mjs";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID as random_uuid } from "node:crypto";
import { digest, fail, open_readonly, snapshot_file, read_snapshot, check_integrity } from "./session-v7-database.mjs";
import { exists, ordinary, inside, file_hash, sync_path, save_json, discover, diagnostic, attachment_inventory, copy_attachments, copy_verified_file, source_database_path } from "./session-v8-files.mjs";
import { plan_agent, validate_agent, import_agent, verify_agent } from "./session-v8-plan.mjs";

/** 同步更新只包含结构、映射和摘要的私有清单。 */
function save_manifest(batch_path, manifest) { save_json(path.join(batch_path, "manifest.json"), manifest, true); }

/** 仅操作当前批次拥有的 Agent 暂存目录，保证与目标同文件系统。 */
function stage_path(root_path, agent, manifest) { return path.join(root_path, "agents", agent.agent_id, `.session-migration-${manifest.migration_id}`); }

/** 旧源 WAL 包含在逻辑快照中；任何源变化都要求重新预检。 */
function assert_sources(root_path, agent, runtime) {
  for (const source of agent.sources) {
    if (snapshot_file(source_database_path(root_path, source)).fingerprint !== source.source_fingerprint) fail("source_changed_since_preflight");
    if (digest(attachment_inventory(path.join(path.dirname(source_database_path(root_path, source)), "attachments"))) !== digest(source.attachments)) fail("attachments_changed");
    for (const item of source.attachments) {
      const metadata = fs.statSync(inside(path.join(path.dirname(source_database_path(root_path, source)), "attachments"), item.relative_path));
      const version = runtime.file_read_version(metadata);
      if (version !== source.media_versions[item.relative_path]) fail("source_attachment_version_changed");
    }
  }
}

/** 不含正文的只读全根预检；任何 Agent 阻塞均阻止整批执行。 */
export function preflight(root_path, runtime, repairs = new Map(), recovered_sources = []) {
  assert_v8_runtime(runtime);
  root_path = fs.realpathSync(root_path);
  const agents = discover(root_path);
  for (const recovered of recovered_sources) {
    if (exists(inside(root_path, recovered.relative_path))) fail("recovered_source_conflicts_with_current_root");
    let agent = agents.find(agent => agent.agent_id === recovered.agent_id);
    if (!agent) {
      if (!exists(path.join(root_path, "agents", recovered.agent_id))) fail("recovered_agent_not_found");
      agent = { agent_id: recovered.agent_id, sources: [], target_existed: exists(path.join(root_path, "agents", recovered.agent_id, "sessions.db")) }; agents.push(agent);
    }
    agent.sources.push({ ...recovered, storage_id: random_uuid() });
    agent.sources.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  }
  const result = { format_version: 1, target_version: 8, root_path, created_at: Date.now(), agents, status: "planned", repair_manifest_sha256: digest([...repairs]), recovered_sources_sha256: digest(recovered_sources) };
  const consumed = new Set();
  const selected_paths = new Set(agents.flatMap(agent => agent.sources.map(source => source.relative_path)));
  for (const key of repairs.keys()) if (selected_paths.has(key)) consumed.add(key);
  for (const agent of agents) {
    try {
      if (agent.target_existed) fail("existing_target_requires_review");
      const records = plan_agent(root_path, agent, runtime, repairs);
      validate_agent(agent.agent_id, records, runtime);
      for (const record of records) {
        Object.assign(record.source, { source_fingerprint: record.source_fingerprint, attachments: record.attachments, media_versions: record.media_versions,
          conversion: record.conversion, cleared_derived_tables: record.derived_tables,
          archived_at_basis: record.source.partition === "archived-sessions" ? "source_updated_at_archive_time_unavailable" : null,
          messages: record.messages.length, parts: record.parts.length });
        if (repairs.has(record.source.relative_path)) consumed.add(record.source.relative_path);
      }
      agent.status = "planned";
    } catch (error) {
      agent.status = "blocked"; agent.reason = diagnostic(error);
      if (error.source_relative_path) agent.blocked_source = error.source_relative_path;
      if (error.source_blockers) agent.blockers = error.source_blockers;
      result.status = "blocked";
    }
  }
  if ([...repairs.keys()].some(key => !consumed.has(key))) { result.status = "blocked"; result.reason = "unconsumed_repair_database"; }
  if (!agents.some(agent => agent.sources.length)) { result.status = "blocked"; result.reason = "no_legacy_databases"; }
  const bytes = agents.flatMap(agent => agent.sources).reduce((total, source) => {
    const database_path = source_database_path(root_path, source);
    return total + [database_path, `${database_path}-wal`].reduce((sum, file_path) => sum + (exists(file_path) ? ordinary(file_path).size : 0), 0)
      + (source.attachments ?? []).reduce((sum, item) => sum + item.bytes, 0);
  }, 0);
  result.source_bytes = bytes;
  // 备份、目标暂存与恢复余量；批次与数据根可能分属不同卷，分别检查。
  result.required_free_bytes = Math.ceil(bytes * 2 + Math.max(bytes * 0.2, 512 * 1024 * 1024));
  const space = fs.statfsSync(root_path);
  result.available_bytes = space.bavail * space.bsize;
  if (result.available_bytes < result.required_free_bytes) { result.status = "blocked"; result.reason = "insufficient_space"; }
  return result;
}

/** 批次读取拒绝不受支持的结构，所有写路径重新绑定批次根与映射。 */
export function read_manifest(batch_path, root_path) {
  ordinary(batch_path, true);
  const manifest_path = path.join(batch_path, "manifest.json");
  ordinary(manifest_path);
  if ((fs.statSync(manifest_path).mode & 0o077) !== 0) fail("manifest_requires_private_permissions");
  const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
  if (manifest.format_version !== 1 || manifest.target_version !== 8 || !/^[a-f0-9-]{36}$/u.test(manifest.migration_id ?? "")
    || manifest.root_path !== fs.realpathSync(root_path) || !Array.isArray(manifest.agents)) fail("migration_manifest_invalid");
  const ids = new Set();
  for (const agent of manifest.agents) {
    if (typeof agent.agent_id !== "string" || !agent.agent_id || /[\\/\0]/u.test(agent.agent_id) || [".", ".."].includes(agent.agent_id) || ids.has(agent.agent_id) || !Array.isArray(agent.sources) || !agent.sources.length) fail("migration_manifest_invalid");
    ids.add(agent.agent_id);
    const paths = new Set(); const storage_ids = new Set();
    for (const source of agent.sources) {
      if (source.agent_id !== agent.agent_id || !["sessions", "archived-sessions"].includes(source.partition)
        || !/^[a-f0-9-]{36}$/u.test(source.storage_id ?? "") || storage_ids.has(source.storage_id)
        || typeof source.source_fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(source.source_fingerprint)
        || path.relative(root_path, inside(root_path, source.relative_path)) !== source.relative_path || paths.has(source.relative_path)
        || source.relative_path.split(path.sep).length !== 6
        || source.relative_path !== path.join("agents", agent.agent_id, source.partition, encodeURIComponent(source.category), source.session_id, "session.db")
        || !Array.isArray(source.attachments)) fail("migration_manifest_invalid");
      paths.add(source.relative_path); storage_ids.add(source.storage_id);
      if (source.recovered_from && (typeof source.recovered_from !== "string" || !path.isAbsolute(source.recovered_from) || fs.realpathSync(source.recovered_from) !== source.recovered_from)) fail("migration_manifest_invalid");
      for (const attachment of source.attachments) {
        inside(root_path, attachment.relative_path);
        if (!/^[a-f0-9]{64}$/u.test(attachment.sha256 ?? "") || !Number.isSafeInteger(attachment.bytes) || attachment.bytes < 0) fail("migration_manifest_invalid");
      }
    }
  }
  return manifest;
}

/** 一致性备份逐库核验；中断留下的未登记文件仅在完整核验后可接管。 */
async function backup_agent(root_path, batch_path, agent, manifest) {
  const backup_root = path.join(batch_path, "original");
  for (const source of agent.sources) {
    const source_path = source_database_path(root_path, source);
    const backup_path = inside(backup_root, source.relative_path);
    fs.mkdirSync(path.dirname(backup_path), { recursive: true, mode: 0o700 });
    if (!exists(backup_path)) {
      const connection = open_readonly(source_path);
      const pending_path = `${backup_path}.${random_uuid()}.pending`;
      try {
        await backup(connection, pending_path);
        if (snapshot_file(pending_path).fingerprint !== source.source_fingerprint) fail("backup_fingerprint_mismatch");
        sync_path(pending_path); fs.renameSync(pending_path, backup_path); sync_path(path.dirname(backup_path));
      } finally { connection.close(); }
    }
    if (snapshot_file(backup_path).fingerprint !== source.source_fingerprint) fail("backup_fingerprint_mismatch");
    fs.chmodSync(backup_path, 0o400); sync_path(backup_path); sync_path(path.dirname(backup_path));
    const hash = file_hash(backup_path);
    if (source.backup_sha256 && source.backup_sha256 !== hash) fail("backup_file_changed");
    source.backup_sha256 = hash;
    const attachments_path = path.join(path.dirname(backup_path), "attachments");
    copy_attachments(path.join(path.dirname(source_path), "attachments"), attachments_path, source.attachments);
    if (digest(attachment_inventory(attachments_path)) !== digest(source.attachments)) fail("backup_attachments_mismatch");
    save_manifest(batch_path, manifest);
  }
}

/** 正式转换为非保留命名的旧附件登记精确所属，清理不能靠扫描普通文件名猜归属。 */
function prepare_attachment_ownership(record_path, agent_id, source, readonly = false) {
  ordinary(record_path, true);
  const manifest_path = path.join(record_path, ".owned-attachments.json");
  const ownership = { format_version: 1, agent_id, storage_id: source.storage_id, files: source.attachments.map(item => item.relative_path) };
  if (exists(manifest_path)) {
    ordinary(manifest_path);
    if (digest(JSON.parse(fs.readFileSync(manifest_path, "utf8"))) !== digest(ownership)) fail("attachment_ownership_changed");
  } else if (!readonly) save_json(manifest_path, ownership);
}

/** 暂存只从校验过的备份生成；重复运行不会重新分配 UUID。 */
function stage_agent(root_path, batch_path, agent, manifest, runtime, repairs) {
  const stage = stage_path(root_path, agent, manifest);
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  for (const source of agent.sources) {
    const published_files = path.join(root_path, "agents", agent.agent_id, "session-files", source.storage_id, "attachments");
    const files_path = exists(published_files) ? published_files : path.join(stage, "session-files", source.storage_id, "attachments");
    copy_attachments(path.join(path.dirname(inside(path.join(batch_path, "original"), source.relative_path)), "attachments"), files_path, source.attachments);
    prepare_attachment_ownership(path.dirname(files_path), agent.agent_id, source);
    source.target_media_versions = Object.fromEntries(source.attachments.map(item => [item.relative_path, runtime.file_read_version(fs.statSync(inside(files_path, item.relative_path)))]));
  }
  save_manifest(batch_path, manifest);
  const records = plan_agent(root_path, agent, runtime, repairs, path.join(batch_path, "original"));
  const database_path = path.join(stage, "sessions.db");
  if (!exists(database_path)) {
    const pending = path.join(stage, `${random_uuid()}.db`);
    const database = new DatabaseSync(pending);
    try {
      database.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
      if (process.platform === "darwin") database.exec("PRAGMA fullfsync = ON;");
      import_agent(database, agent.agent_id, records, runtime);
    } finally { database.close(); }
    fs.chmodSync(pending, 0o600); sync_path(pending);
    fs.renameSync(pending, database_path); sync_path(stage);
  }
  const database = open_readonly(database_path);
  try { verify_agent(database, agent.agent_id, records, runtime); }
  finally { database.close(); }
  const fingerprint = snapshot_file(database_path).fingerprint;
  if (agent.target_fingerprint && agent.target_fingerprint !== fingerprint) fail("staged_target_changed");
  agent.target_fingerprint = fingerprint;
  agent.status = "staged"; save_manifest(batch_path, manifest);
}

/** 发布后核对完整逻辑指纹、独立文件清单；文件存在不等于迁移成功。 */
function verify_published(root_path, agent) {
  const agent_path = path.join(root_path, "agents", agent.agent_id);
  const target_path = path.join(agent_path, "sessions.db");
  if (snapshot_file(target_path).fingerprint !== agent.target_fingerprint) fail("published_target_changed_or_business_write");
  for (const source of agent.sources) {
    if (digest(attachment_inventory(path.join(agent_path, "session-files", source.storage_id, "attachments"))) !== digest(source.attachments)) fail("published_attachments_mismatch");
    prepare_attachment_ownership(path.join(agent_path, "session-files", source.storage_id), agent.agent_id, source, true);
  }
}

/** 同卷 rename 逐 Agent 发布；根 pending 标记阻止部分布局被宿主消费。 */
function publish_agent(root_path, batch_path, agent, manifest, runtime) {
  const agent_path = path.join(root_path, "agents", agent.agent_id);
  const stage = stage_path(root_path, agent, manifest);
  const files_path = path.join(agent_path, "session-files");
  if (!exists(files_path)) fs.mkdirSync(files_path, { mode: 0o700 });
  ordinary(files_path, true);
  for (const source of agent.sources) {
    const record_path = path.join(files_path, source.storage_id);
    if (!exists(record_path)) { fs.renameSync(path.join(stage, "session-files", source.storage_id), record_path); sync_path(files_path); }
    if (digest(attachment_inventory(path.join(record_path, "attachments"))) !== digest(source.attachments)) fail("published_attachments_mismatch");
  }
  const target_path = path.join(agent_path, "sessions.db");
  if (!exists(target_path)) { fs.renameSync(path.join(stage, "sessions.db"), target_path); sync_path(agent_path); }
  verify_published(root_path, agent);
  runtime.AgentSessionFileLease.acquire(target_path, agent.agent_id, false, true).release();
  agent.status = "published"; save_manifest(batch_path, manifest);
}

/** 验证整根没有多出、遗漏或变化的源库；未登记的新库不能随完成标记被放行。 */
function assert_scope(root_path, manifest, runtime) {
  const actual = discover(root_path).flatMap(agent => agent.sources.map(source => source.relative_path));
  actual.push(...manifest.agents.flatMap(agent => agent.sources.filter(source => source.recovered_from).map(source => source.relative_path)));
  actual.sort();
  const expected = manifest.agents.flatMap(agent => agent.sources.map(source => source.relative_path)).sort();
  if (digest(actual) !== digest(expected)) fail("source_scope_changed");
  for (const agent of manifest.agents) assert_sources(root_path, agent, runtime);
}

/** 全批次校验通过才写 ready；重复执行只核验，不覆盖已发布的业务数据。 */
export async function migrate(root_path, batch_path, runtime, repairs = new Map(), recovered_sources = []) {
  assert_v8_runtime(runtime);
  root_path = fs.realpathSync(root_path); batch_path = runtime.resolve_resource_root(batch_path);
  if (batch_path === root_path || batch_path.startsWith(`${root_path}${path.sep}`)) fail("batch_must_be_outside_data_root");
  const lease = runtime.RootLease.acquire_write(root_path);
  try {
    let manifest;
    if (exists(path.join(batch_path, "manifest.json"))) manifest = read_manifest(batch_path, root_path);
    else {
      if (exists(batch_path)) fail("batch_directory_already_exists");
      manifest = preflight(root_path, runtime, repairs, recovered_sources);
      if (manifest.status !== "planned") return manifest;
      const parent_path = path.dirname(batch_path);
      fs.mkdirSync(parent_path, { recursive: true, mode: 0o700 });
      const space = fs.statfsSync(parent_path);
      if (space.bavail * space.bsize < manifest.required_free_bytes) fail("insufficient_backup_space");
      const marker_path = path.join(root_path, runtime.SESSION_STORAGE_MARKER);
      manifest.original_marker = exists(marker_path) ? JSON.parse(fs.readFileSync(marker_path, "utf8")) : null;
      manifest.migration_id = random_uuid(); manifest.status = "migrating";
      fs.mkdirSync(batch_path, { mode: 0o700 });
      save_json(path.join(batch_path, "manifest.json"), manifest);
    }
    if (manifest.repair_manifest_sha256 !== digest([...repairs])) fail("repair_manifest_changed");
    if (manifest.recovered_sources_sha256 !== digest(recovered_sources)) fail("recovered_sources_manifest_changed");
    if (!["migrating", "ready"].includes(manifest.status)) fail("batch_not_resumable");
    assert_scope(root_path, manifest, runtime);
    const marker_path = path.join(root_path, runtime.SESSION_STORAGE_MARKER);
    const marker = exists(marker_path) ? JSON.parse(fs.readFileSync(marker_path, "utf8")) : null;
    if (marker && marker.migration_id !== manifest.migration_id) fail("root_marker_owned_by_another_batch");
    if (manifest.status === "ready") {
      for (const agent of manifest.agents) {
        verify_published(root_path, agent);
        runtime.AgentSessionFileLease.acquire(path.join(root_path, "agents", agent.agent_id, "sessions.db"), agent.agent_id, false, true).release();
        for (const source of agent.sources) prepare_attachment_ownership(path.join(root_path, "agents", agent.agent_id, "session-files", source.storage_id), agent.agent_id, source);
      }
      if (marker?.state !== "ready") fail("root_marker_mismatch");
      return manifest;
    }
    save_json(marker_path, { format_version: 8, state: "migrating", migration_id: manifest.migration_id }, exists(marker_path));
    for (const agent of manifest.agents) {
      // 发布已发生但清单尚未同步的崩溃窗口，由完整目标指纹识别真实事实。
      if (exists(path.join(root_path, "agents", agent.agent_id, "sessions.db"))) {
        if (!agent.target_fingerprint) fail("unexpected_target_database");
        verify_published(root_path, agent);
        runtime.AgentSessionFileLease.acquire(path.join(root_path, "agents", agent.agent_id, "sessions.db"), agent.agent_id, false, true).release();
        for (const source of agent.sources) prepare_attachment_ownership(path.join(root_path, "agents", agent.agent_id, "session-files", source.storage_id), agent.agent_id, source);
        agent.status = "published"; save_manifest(batch_path, manifest); continue;
      }
      assert_sources(root_path, agent, runtime);
      await backup_agent(root_path, batch_path, agent, manifest);
      stage_agent(root_path, batch_path, agent, manifest, runtime, repairs);
      assert_sources(root_path, agent, runtime);
      publish_agent(root_path, batch_path, agent, manifest, runtime);
    }
    assert_scope(root_path, manifest, runtime);
    for (const agent of manifest.agents) verify_published(root_path, agent);
    save_json(marker_path, { format_version: 8, state: "ready", migration_id: manifest.migration_id }, true);
    manifest.status = "ready"; manifest.completed_at = Date.now(); save_manifest(batch_path, manifest);
    return manifest;
  } finally { lease.release(); }
}

/** 只读验证包含源、原始备份、发布目标及根标记；不获取写锁或创建任何文件。 */
export function verify_batch(root_path, batch_path, runtime) {
  assert_v8_runtime(runtime);
  const manifest = read_manifest(batch_path, root_path);
  assert_scope(root_path, manifest, runtime);
  for (const agent of manifest.agents) {
    for (const source of agent.sources) {
      const original_path = inside(path.join(batch_path, "original"), source.relative_path);
      if (file_hash(original_path) !== source.backup_sha256 || snapshot_file(original_path).fingerprint !== source.source_fingerprint) fail("backup_fingerprint_mismatch");
      if (digest(attachment_inventory(path.join(path.dirname(original_path), "attachments"))) !== digest(source.attachments)) fail("backup_attachments_mismatch");
    }
    verify_published(root_path, agent);
  }
  const marker = JSON.parse(fs.readFileSync(path.join(root_path, runtime.SESSION_STORAGE_MARKER), "utf8"));
  if (manifest.status !== "ready" || marker.state !== "ready" || marker.migration_id !== manifest.migration_id) fail("migration_incomplete");
  return { status: "verified", migration_id: manifest.migration_id, agents: manifest.agents.length };
}

/** 回退只撤销本批发布，旧源始终未改；保留新库到批次而非删除。业务写入后拒绝。 */
export function restore_batch(root_path, batch_path, runtime) {
  assert_v8_runtime(runtime);
  const lease = runtime.RootLease.acquire_write(root_path);
  const file_leases = [];
  try {
    const manifest = read_manifest(batch_path, root_path);
    if (!["migrating", "ready", "restoring", "restored"].includes(manifest.status)) fail("batch_not_restorable");
    const marker_path = path.join(root_path, runtime.SESSION_STORAGE_MARKER);
    const marker = exists(marker_path) ? JSON.parse(fs.readFileSync(marker_path, "utf8")) : null;
    if (manifest.status === "restored") {
      if (marker?.migration_id === manifest.migration_id && marker.state === "restoring") {
        if (manifest.original_marker) save_json(marker_path, manifest.original_marker, true);
        else { fs.unlinkSync(marker_path); sync_path(root_path); }
      } else if (digest(marker) !== digest(manifest.original_marker)) fail("root_marker_mismatch");
      return { status: "restored", migration_id: manifest.migration_id };
    }
    if (marker?.migration_id !== manifest.migration_id) fail("root_marker_owned_by_another_batch");
    assert_scope(root_path, manifest, runtime);
    // 先检查全部 Agent，任何已发生的业务写入都不能触发部分回退。
    for (const agent of manifest.agents) {
      const target_path = path.join(root_path, "agents", agent.agent_id, "sessions.db");
      if (exists(target_path)) {
        file_leases.push(runtime.AgentSessionFileLease.acquire(target_path, agent.agent_id, true));
        verify_published(root_path, agent);
      }
      for (const source of agent.sources) {
        const original_path = inside(path.join(batch_path, "original"), source.relative_path);
        if (source.backup_sha256 && file_hash(original_path) !== source.backup_sha256) fail("backup_file_changed");
      }
    }
    manifest.status = "restoring"; save_manifest(batch_path, manifest);
    save_json(marker_path, { format_version: 8, state: "restoring", migration_id: manifest.migration_id }, true);
    for (const agent of manifest.agents) {
      const agent_path = path.join(root_path, "agents", agent.agent_id);
      const retained_path = path.join(batch_path, "retained", agent.agent_id);
      fs.mkdirSync(retained_path, { recursive: true, mode: 0o700 });
      // 先通过 SQLite backup 保留目标，然后删除已 checkpoint 的无业务写入发布库。
      const target_path = path.join(agent_path, "sessions.db");
      if (exists(target_path)) {
        const retained_db = path.join(retained_path, "sessions.db");
        if (!exists(retained_db)) {
          // restore 为同步入口，保留关闭后的库使用普通复制；有 WAL 时先显式 checkpoint。
          const database = new DatabaseSync(target_path);
          try {
            if (database.prepare("SELECT first_business_write_at FROM storage_metadata").get().first_business_write_at !== null) fail("restore_after_business_write_forbidden");
            database.exec("PRAGMA wal_checkpoint(TRUNCATE);"); check_integrity(database);
          } finally { database.close(); }
          copy_verified_file(target_path, retained_db, file_hash(target_path), path.join(retained_path, ".session-migration-copies"));
        }
        if (snapshot_file(retained_db).fingerprint !== agent.target_fingerprint) fail("retained_database_mismatch");
        for (const suffix of ["-wal", "-shm", ""]) if (exists(`${target_path}${suffix}`)) fs.unlinkSync(`${target_path}${suffix}`);
        sync_path(agent_path);
      }
      // 附件保留在原 UUID 目录，旧运行时不会读取它们；避免跨卷移动失败导致不完整回退。
      agent.status = "restored"; save_manifest(batch_path, manifest);
    }
    manifest.status = "restored"; save_manifest(batch_path, manifest);
    if (manifest.original_marker) save_json(marker_path, manifest.original_marker, true);
    else { fs.unlinkSync(marker_path); sync_path(root_path); }
    return { status: "restored", migration_id: manifest.migration_id };
  } finally { for (const file_lease of file_leases) file_lease.release(); lease.release(); }
}
