/**
 * v8 → v9 全根离线迁移拥有者：规划、备份、暂存、发布、验证与业务写入前恢复。
 * 工具只导入 schema/codec，不创建执行器；RootLease 与 Agent 文件租约覆盖全部写阶段。
 * 清单绑定身份策略与来源精确地址，保留源记录 UUID；正文只存在受保护的原始/暂存文件中。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID as random_uuid, createHash as create_hash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { digest, fail } from "./session-v7-database.mjs";
import { exists, ordinary, inside, save_json, diagnostic, sync_path } from "./session-v8-files.mjs";
import { assert_v8_database, database_fingerprint, fingerprint_file, open_source, validate_v9 } from "./session-v9-database.mjs";
import { create_resolver, identity_policy, identity_rows, uuid_pattern } from "./session-v9-identities.mjs";
import { convert_database } from "./session-v9-conversion.mjs";
import { entries, reference_scope, visit_reference_files, convert_channel_database } from "./session-v9-references.mjs";
import { convert_platform_database } from "./session-v9-settings.mjs";
import { create_result_rewriter } from "./session-v9-results.mjs";
import { create_recovery, recovery_policy } from "./session-v9-recovery.mjs";
import { artifact, backup_artifact, batch_file, current_fingerprint, directory_fingerprint, final_relative,
  publish_file, publish_directory, restore_artifact, save_manifest } from "./session-v9-batch.mjs";

const text_hash = text => create_hash("sha256").update(text).digest("hex");
const marker_name = "session-storage.json";

/** 同一协议版本覆盖 schema、引用转换和批次，不允许旧运行时解释新清单。 */
export function assert_v9_runtime(runtime) {
  if (runtime.AGENT_SESSION_SCHEMA_VERSION !== 9) fail("v9_tool_runtime_version_mismatch");
}

/** 只枚举正式 Agent 单库，旧分库仍由 v8 工具单独负责。 */
function discover_agents(root_path) {
  const agents = [];
  for (const entry of entries(path.join(root_path, "agents"))) {
    const imports_path = path.join(entry.file_path, ".session-imports");
    if (exists(imports_path) && fs.readdirSync(imports_path).length) fail("legacy_import_batch_requires_review");
    const database_path = path.join(entry.file_path, "sessions.db");
    if (exists(database_path)) { ordinary(database_path); agents.push({ agent_id: entry.name, relative_path: path.relative(root_path, database_path) }); }
    else if (["sessions", "archived-sessions"].some(name => exists(path.join(entry.file_path, name)))) fail("legacy_partition_requires_v8_migration");
  }
  return agents;
}

/** 允许已完成 v8 根或没有标记的正式 v8 单库；任何中间态必须继续原批次。 */
function source_marker(root_path) {
  const marker_path = path.join(root_path, marker_name);
  if (!exists(marker_path)) return null;
  ordinary(marker_path);
  const marker = JSON.parse(fs.readFileSync(marker_path, "utf8"));
  if (marker.format_version !== 8 || marker.state !== "ready") fail("source_root_is_not_ready_v8");
  return marker;
}

/** SQLite 一致性复制保留内部自增序列、外键和全部队列，不改变源 WAL。 */
async function copy_database(source_path, target_path) {
  const source = open_source(source_path);
  try {
    await backup(source, target_path); fs.chmodSync(target_path, 0o600);
  } finally { source.close(); }
}

/** 在一个 Agent 的短生命周期中预检实际转换路径，失败只输出固定诊断与结构地址。 */
export async function preflight(root_path, runtime, options = {}) {
  assert_v9_runtime(runtime); root_path = fs.realpathSync(root_path); ordinary(root_path, true);
  const manifest = { format_version: 9, identity_policy, migration_id: random_uuid(), root_path, status: "planned",
    original_marker: source_marker(root_path), agents: discover_agents(root_path), artifacts: [], blockers: [] };
  const working_path = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-v9-preflight-"));
  let results;
  try {
    for (const agent of manifest.agents) {
      const source = open_source(inside(root_path, agent.relative_path));
      try {
        assert_v8_database(source, agent.agent_id);
        agent.identities = identity_rows(source, agent.agent_id);
        agent.source_fingerprint = database_fingerprint(source);
      } catch (error) { manifest.blockers.push({ agent_id: agent.agent_id, phase: "source", reason: diagnostic(error) }); }
      finally { source.close(); }
    }
    if (manifest.blockers.length) { manifest.status = "blocked"; return manifest; }
    const context = { root_path, migration_id: manifest.migration_id, agents: manifest.agents, resolve: create_resolver(manifest.agents) };
    context.recovery = create_recovery(context, options.recover_reviewed);
    results = create_result_rewriter(context, runtime); context.rewrite_reference = results.rewrite; context.assert_fork = results.assert_fork;
    manifest.reference_scope = reference_scope(root_path, manifest.agents);
    for (const agent of manifest.agents) {
      const source = open_source(inside(root_path, agent.relative_path));
      const target_path = path.join(working_path, `${digest(agent.agent_id)}.db`);
      try {
        agent.counts = convert_database(source, agent, context, runtime, target_path);
        manifest.artifacts.push({ ...artifact("database", agent.relative_path, agent.source_fingerprint), agent_id: agent.agent_id });
      } catch (error) { manifest.blockers.push({ agent_id: agent.agent_id, phase: "conversion", reason: diagnostic(error) }); }
      finally { source.close(); fs.rmSync(target_path, { force: true }); }
      for (const identity of agent.identities) {
        const relative = path.join("agents", agent.agent_id, "session-files", identity.source_storage_id);
        if (!exists(inside(root_path, relative))) continue;
        manifest.artifacts.push(artifact("directory", relative, directory_fingerprint(inside(root_path, relative)),
          path.join("agents", agent.agent_id, "session-files", identity.session_id)));
      }
    }
    try {
      visit_reference_files(context, (source, target, raw, text) => {
        manifest.artifacts.push({ ...artifact("file", path.relative(root_path, source), text_hash(raw), path.relative(root_path, target)), target_fingerprint: text_hash(text) });
      }, (error, relative_path) => manifest.blockers.push({ relative_path, phase: "references", reason: diagnostic(error), ...(error.reference ? { reference: error.reference } : {}) }));
    } catch (error) { manifest.blockers.push({ phase: "references", reason: diagnostic(error) }); }
    for (const prefix of ["messenger", "chat"]) {
      const relative_path = path.join("powers", prefix, `${prefix}.db`);
      if (!exists(inside(root_path, relative_path))) continue;
      const target = path.join(working_path, `${prefix}.db`);
      try {
        const source_fingerprint = fingerprint_file(inside(root_path, relative_path));
        await copy_database(inside(root_path, relative_path), target);
        const database = new DatabaseSync(target);
        try { convert_channel_database(database, prefix, context.resolve, context.recovery); } finally { database.close(); }
        manifest.artifacts.push({ ...artifact("database", relative_path, source_fingerprint), channel: prefix });
      } catch (error) { manifest.blockers.push({ relative_path, phase: "channel", reason: diagnostic(error), ...(error.reference ? { reference: error.reference } : {}) }); }
    }
    const platform_path = path.join(root_path, "downcity.db");
    if (exists(platform_path)) {
      try {
        const source_fingerprint = fingerprint_file(platform_path);
        const target = path.join(working_path, "platform.db"); await copy_database(platform_path, target);
        const database = new DatabaseSync(target);
        try { convert_platform_database(database, context); } finally { database.close(); }
        manifest.artifacts.push({ ...artifact("database", "downcity.db", source_fingerprint), platform: true });
      } catch (error) { manifest.blockers.push({ relative_path: "downcity.db", phase: "settings", reason: diagnostic(error), ...(error.reference ? { reference: error.reference } : {}) }); }
    }
    if (context.recovery) manifest.recovery = context.recovery.finish();
    if (!manifest.agents.length) manifest.blockers.push({ phase: "source", reason: "no_v8_agent_databases" });
    if (manifest.blockers.length) manifest.status = "blocked";
    return manifest;
  } finally { results?.close(); fs.rmSync(working_path, { recursive: true, force: true }); }
}

/** 读取清单验证根身份和全部路径，禁止编辑清单扩大到数据根之外。 */
export function read_manifest(root_path, batch_path) {
  ordinary(batch_path, true); const manifest_path = path.join(batch_path, "manifest.json"); ordinary(manifest_path);
  if (fs.statSync(manifest_path).mode & 0o077) fail("batch_requires_private_permissions");
  const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
  if (manifest.identity_policy !== identity_policy) fail("batch_identity_policy_requires_review");
  if (manifest.format_version !== 9 || manifest.root_path !== fs.realpathSync(root_path) || !uuid_pattern.test(manifest.migration_id)
    || !Array.isArray(manifest.artifacts) || !Array.isArray(manifest.agents) || !Array.isArray(manifest.reference_scope)
    || !["planned", "prepared", "publishing", "ready", "restoring", "restored"].includes(manifest.status)) fail("batch_identity_invalid");
  const keys = new Set(); const targets = new Set();
  for (const item of manifest.artifacts) {
    if (!["file", "database", "directory"].includes(item.kind) || item.key !== digest([item.kind, item.relative_path])
      || !/^[a-f0-9]{64}$/u.test(item.source_fingerprint ?? "") || keys.has(item.key) || targets.has(item.target_relative)) fail("batch_artifact_invalid");
    inside(root_path, item.relative_path); inside(root_path, item.target_relative);
    keys.add(item.key); targets.add(item.target_relative);
  }
  create_resolver(manifest.agents);
  if (manifest.recovery && (manifest.recovery.policy !== recovery_policy || !Array.isArray(manifest.recovery.entries))) fail("recovery_policy_invalid");
  return manifest;
}

/** 独立的外部批次，既不藏进数据根，也不允许数据根位于批次之中。 */
function normalize_batch(root_path, batch_path, runtime) {
  const normalized = runtime.resolve_resource_root(batch_path);
  if (normalized === root_path || normalized.startsWith(`${root_path}${path.sep}`) || root_path.startsWith(`${normalized}${path.sep}`)) fail("batch_must_be_outside_data_root");
  return normalized;
}

/** 全批备份校验后才能写 migrating，暂存可以安全在崩溃后重建。 */
async function prepare_batch(manifest, batch_path, runtime) {
  const { root_path } = manifest;
  for (const item of manifest.artifacts) await backup_artifact(root_path, batch_path, item);
  const context = { root_path, migration_id: manifest.migration_id, agents: manifest.agents, resolve: create_resolver(manifest.agents) };
  context.recovery = create_recovery(context, Boolean(manifest.recovery), manifest.recovery?.entries);
  const results = create_result_rewriter(context, runtime); context.rewrite_reference = results.rewrite; context.assert_fork = results.assert_fork;
  try {
    fs.mkdirSync(path.join(batch_path, "staged"), { recursive: true, mode: 0o700 });
    const texts = new Map(manifest.artifacts.filter(item => item.kind === "file").map(item => [item.relative_path, item]));
    visit_reference_files(context, (source, _target, _raw, text) => {
      const item = texts.get(path.relative(root_path, source));
      if (!item || text_hash(text) !== item.target_fingerprint) fail("reference_plan_changed");
      fs.writeFileSync(batch_file(batch_path, "staged", item), text, { mode: 0o600 });
      texts.delete(item.relative_path);
    });
    if (texts.size) fail("reference_plan_changed");
    for (const item of manifest.artifacts.filter(item => item.kind === "database")) {
      const target = batch_file(batch_path, "staged", item);
      if (exists(target)) fs.unlinkSync(target);
      if (item.agent_id) {
        const source = open_source(batch_file(batch_path, "original", item));
        try { convert_database(source, manifest.agents.find(agent => agent.agent_id === item.agent_id), context, runtime, target); }
        finally { source.close(); }
      } else {
        await copy_database(batch_file(batch_path, "original", item), target);
        const database = new DatabaseSync(target);
        try {
          if (item.platform) convert_platform_database(database, context);
          else convert_channel_database(database, item.channel, context.resolve, context.recovery);
        } finally { database.close(); }
      }
      fs.chmodSync(target, 0o600);
      item.target_fingerprint = fingerprint_file(target);
    }
    context.recovery?.finish();
    for (const item of manifest.artifacts.filter(item => item.kind !== "directory")) sync_path(batch_file(batch_path, "staged", item));
    // 所有来源必须仍是预检快照；先检查全批，不能边检测变化边发布。
    for (const item of manifest.artifacts) if (current_fingerprint(inside(root_path, item.relative_path), item.kind) !== item.source_fingerprint) fail("source_changed_since_preflight");
    assert_reference_scope(manifest, false);
    manifest.status = "prepared"; save_manifest(batch_path, manifest);
  } finally { results.close(); }
}

/** 根标记必须由本批拥有，不能覆盖另一批迁移现场。 */
function write_marker(manifest, state) {
  save_json(path.join(manifest.root_path, marker_name), { format_version: 9, state, migration_id: manifest.migration_id }, true);
}

/** Agent 集合是批次范围的一部分，重入不能悄悄遗漏新增或移除的 Agent。 */
function assert_agent_scope(manifest) {
  const actual = discover_agents(manifest.root_path).map(agent => agent.agent_id);
  if (digest(actual) !== digest(manifest.agents.map(agent => agent.agent_id))) fail("agent_scope_changed");
}

/** 根租约保护合作写者，资源名字校验另外防止外部工具在停写声明后扩大实际范围。 */
function assert_reference_scope(manifest, published) {
  const files = new Map(manifest.artifacts.filter(item => item.kind !== "directory").map(item => [item.relative_path, item.target_relative]));
  const directories = new Map(manifest.artifacts.filter(item => item.kind === "directory").map(item => [item.relative_path, item.target_relative]));
  const expected = manifest.reference_scope.map(relative_path => {
    if (!published) return relative_path;
    let target = files.get(relative_path) ?? relative_path;
    for (let ancestor = target; ancestor !== "."; ancestor = path.dirname(ancestor)) {
      const replacement = directories.get(ancestor);
      if (replacement) { target = replacement + target.slice(ancestor.length); break; }
    }
    return target;
  }).sort();
  if (digest(reference_scope(manifest.root_path, manifest.agents)) !== digest(expected)) fail("reference_scope_changed");
}

/** 写阶段的独占所有权，所有 Agent 文件访问租约必须一起取得。 */
function acquire_leases(manifest, runtime) {
  const leases = [];
  try {
    for (const agent of manifest.agents) leases.push(runtime.AgentSessionFileLease.acquire(inside(manifest.root_path, agent.relative_path), agent.agent_id, true, true));
    return leases;
  } catch (error) { for (const lease of leases.reverse()) lease.release(); throw error; }
}

/** 显式离线 apply；同一批次可以继续，发布后只接受精确规划目标。 */
export async function migrate(root_path, batch_path, runtime, options = {}) {
  assert_v9_runtime(runtime); root_path = fs.realpathSync(root_path); batch_path = normalize_batch(root_path, batch_path, runtime);
  const root_lease = runtime.RootLease.acquire_write(root_path); let leases = [];
  try {
    let manifest;
    if (exists(path.join(batch_path, "manifest.json"))) manifest = read_manifest(root_path, batch_path);
    else {
      if (exists(batch_path)) fail("batch_directory_already_exists");
      manifest = await preflight(root_path, runtime, options);
      if (manifest.status !== "planned") return manifest;
      fs.mkdirSync(batch_path, { mode: 0o700 }); save_manifest(batch_path, manifest);
    }
    if (["restoring", "restored", "blocked"].includes(manifest.status)) fail("batch_not_applicable");
    assert_agent_scope(manifest); leases = acquire_leases(manifest, runtime);
    if (manifest.status === "ready") return verify_batch(root_path, batch_path, runtime);
    if (manifest.status === "planned") await prepare_batch(manifest, batch_path, runtime);
    const marker_path = path.join(root_path, marker_name);
    if (manifest.status === "prepared") {
      const current_marker = exists(marker_path) ? JSON.parse(fs.readFileSync(marker_path, "utf8")) : null;
      const owned_marker = current_marker?.format_version === 9 && current_marker.state === "migrating" && current_marker.migration_id === manifest.migration_id;
      if (!owned_marker && digest(source_marker(root_path)) !== digest(manifest.original_marker)) fail("root_marker_changed");
      for (const item of manifest.artifacts) if (current_fingerprint(inside(root_path, item.relative_path), item.kind) !== item.source_fingerprint) fail("source_changed_since_preflight");
      assert_reference_scope(manifest, false);
      if (!owned_marker) write_marker(manifest, "migrating");
      manifest.status = "publishing"; save_manifest(batch_path, manifest);
    } else {
      const marker = JSON.parse(fs.readFileSync(marker_path, "utf8"));
      if (marker.migration_id !== manifest.migration_id || marker.format_version !== 9 || !["migrating", "ready"].includes(marker.state)) fail("root_marker_owned_by_another_batch");
    }
    for (const items of [manifest.artifacts.filter(item => item.kind !== "directory"), manifest.artifacts.filter(item => item.kind === "directory")]) {
      let published_since_checkpoint = 0;
      for (const item of items) {
        if (item.published) continue;
        if (item.kind === "directory") publish_directory(root_path, item); else publish_file(root_path, batch_path, item);
        item.published = true;
        // 每个工件都可按来源/目标指纹恢复 ACK，批量落清单避免万条审计记录引发平方写放大。
        if (++published_since_checkpoint >= 128) { save_manifest(batch_path, manifest); published_since_checkpoint = 0; }
      }
      // 附件目录移动会改变引用文件的地址，必须先持久化全部文件 ACK，再进入目录阶段。
      save_manifest(batch_path, manifest);
    }
    verify_artifacts(manifest, batch_path, runtime);
    write_marker(manifest, "ready"); manifest.status = "ready"; save_manifest(batch_path, manifest);
    return manifest;
  } finally { for (const lease of leases.reverse()) lease.release(); root_lease.release(); }
}

/** 所有目标、原始副本与正式 codec 均需重新校验；失败不进入 ready。 */
function verify_artifacts(manifest, batch_path, runtime) {
  assert_agent_scope(manifest);
  assert_reference_scope(manifest, true);
  const directories = manifest.artifacts.filter(item => item.kind === "directory");
  for (const item of manifest.artifacts) {
    if (current_fingerprint(batch_file(batch_path, "original", item), item.kind) !== item.source_fingerprint) fail("original_backup_changed");
    const target = inside(manifest.root_path, final_relative(item, directories));
    if (current_fingerprint(target, item.kind) !== (item.kind === "directory" ? item.source_fingerprint : item.target_fingerprint)) fail("published_target_changed_or_business_write");
    if (item.agent_id) {
      const database = open_source(target);
      try { validate_v9(database, item.agent_id, runtime); } finally { database.close(); }
    }
  }
}

/** verify 只读，不获取写租约、不初始化访问协调、不重建暂存。 */
export function verify_batch(root_path, batch_path, runtime) {
  assert_v9_runtime(runtime); const manifest = read_manifest(root_path, batch_path);
  if (manifest.status !== "ready") fail("batch_not_ready");
  const marker = JSON.parse(fs.readFileSync(path.join(root_path, marker_name), "utf8"));
  if (marker.format_version !== 9 || marker.state !== "ready" || marker.migration_id !== manifest.migration_id) fail("root_marker_mismatch");
  verify_artifacts(manifest, batch_path, runtime);
  return { ...manifest, status: "verified" };
}

/** 恢复首先全批核对；业务写入后禁止覆盖，保留独立备份供人工恢复。 */
export function restore_batch(root_path, batch_path, runtime) {
  assert_v9_runtime(runtime); root_path = fs.realpathSync(root_path); batch_path = normalize_batch(root_path, batch_path, runtime);
  const root_lease = runtime.RootLease.acquire_write(root_path); let leases = [];
  try {
    const manifest = read_manifest(root_path, batch_path);
    if (manifest.status === "restored") return manifest;
    if (!["ready", "restoring"].includes(manifest.status)) fail("restore_requires_completed_batch");
    leases = acquire_leases(manifest, runtime);
    const marker_path = path.join(root_path, marker_name);
    let marker = exists(marker_path) ? JSON.parse(fs.readFileSync(marker_path, "utf8")) : null;
    // 原根标记已恢复而批次 ACK 尚未落盘的窗口，只能在全部原始工件仍一致时结算。
    if (manifest.status === "restoring" && manifest.artifacts.every(item => item.restored) && digest(marker) === digest(manifest.original_marker)) {
      for (const item of manifest.artifacts) if (current_fingerprint(inside(root_path, item.relative_path), item.kind) !== item.source_fingerprint) fail("restored_source_mismatch");
      assert_reference_scope(manifest, false);
      manifest.status = "restored"; save_manifest(batch_path, manifest); return manifest;
    }
    if (manifest.status === "ready") {
      const marker_owned = marker?.migration_id === manifest.migration_id && marker.format_version === 9 && marker.state === "restoring";
      if (marker_owned) verify_artifacts(manifest, batch_path, runtime);
      else { verify_batch(root_path, batch_path, runtime); write_marker(manifest, "restoring"); }
      manifest.status = "restoring"; save_manifest(batch_path, manifest);
    }
    marker = JSON.parse(fs.readFileSync(marker_path, "utf8"));
    if (marker.migration_id !== manifest.migration_id || marker.format_version !== 9 || marker.state !== "restoring") fail("root_marker_owned_by_another_batch");
    // 恢复的每次重入仍先核对全部原始副本，不能让修改过的备份覆盖任何业务文件。
    for (const item of manifest.artifacts) if (current_fingerprint(batch_file(batch_path, "original", item), item.kind) !== item.source_fingerprint) fail("original_backup_changed");
    const directories = manifest.artifacts.filter(item => item.kind === "directory");
    for (const item of manifest.artifacts) {
      const candidates = [...new Set([item.relative_path, item.target_relative, final_relative(item, directories)])]
        .map(relative => inside(root_path, relative)).filter(exists);
      if (!candidates.length) fail("restore_artifact_missing");
      for (const candidate of candidates) {
        const fingerprint = current_fingerprint(candidate, item.kind);
        if (fingerprint !== item.source_fingerprint && fingerprint !== item.target_fingerprint) fail("target_changed_during_restore");
      }
    }
    const ordered = [...manifest.artifacts.filter(item => item.kind === "directory"), ...manifest.artifacts.filter(item => item.kind !== "directory")];
    let restored_since_checkpoint = 0;
    for (const item of ordered) {
      if (item.restored) continue;
      restore_artifact(root_path, batch_path, item); item.restored = true;
      if (++restored_since_checkpoint >= 128) { save_manifest(batch_path, manifest); restored_since_checkpoint = 0; }
    }
    save_manifest(batch_path, manifest);
    for (const item of manifest.artifacts) if (current_fingerprint(inside(root_path, item.relative_path), item.kind) !== item.source_fingerprint) fail("restored_source_mismatch");
    assert_reference_scope(manifest, false);
    if (manifest.original_marker) save_json(path.join(root_path, marker_name), manifest.original_marker, true);
    else { fs.unlinkSync(path.join(root_path, marker_name)); sync_path(root_path); }
    manifest.status = "restored"; save_manifest(batch_path, manifest); return manifest;
  } finally { for (const lease of leases.reverse()) lease.release(); root_lease.release(); }
}
