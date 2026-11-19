/**
 * 相邻 Session 格式升级共用的离线批次引擎。
 * 版本转换负责领域映射；本模块统一持有根租约、完整备份、发布与恢复状态。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID as random_uuid } from "node:crypto";
import { digest, fail } from "./session-v7-database.mjs";
import { exists, ordinary, inside, save_json, sync_path, attachment_inventory, diagnostic } from "./session-v8-files.mjs";
import { open_source, fingerprint_file } from "./session-v9-database.mjs";
import { artifact, backup_artifact, batch_file, publish_file, restore_artifact, save_manifest } from "./session-v9-batch.mjs";
import { uuid_pattern } from "./session-v9-identities.mjs";
import { assert_protocol_database } from "./session-v10-proof.mjs";

/** 版本策略绑定批次身份，转换器不能绕过备份、指纹和附件范围检查。 */
export function create_version_migration({ source_schema, target_schema, migration_policy, content_digest, inspect_database, convert_database }) {
  const marker_name = "session-storage.json";

  /** 显式历史源与正式目标必须与本工具声明一致，不能把其他 schema 解释成本批次的源或目标。 */
  function assert_runtimes(runtime, historical) {
    if (runtime.AGENT_SESSION_SCHEMA_VERSION !== target_schema || historical.AGENT_SESSION_SCHEMA_VERSION !== source_schema) fail("conversion_runtime_mismatch");
  }

  /** 根标记是批次边界；仅吞缺失，不接管另一个正在迁移或恢复的批次。 */
  function read_marker(root_path) {
    const file_path = path.join(root_path, marker_name);
    if (!exists(file_path)) return null;
    ordinary(file_path); return JSON.parse(fs.readFileSync(file_path, "utf8"));
  }

  /** 精确枚举 Agent 业务库，不跟随链接或接管未完成的单记录导入。 */
  function discover(root_path) {
    const directory = path.join(root_path, "agents"); ordinary(directory, true);
    const agents = [];
    for (const name of fs.readdirSync(directory).sort()) {
      const agent_path = path.join(directory, name); ordinary(agent_path, true);
      const imports_path = path.join(agent_path, ".session-imports");
      if (exists(imports_path)) { ordinary(imports_path, true); if (fs.readdirSync(imports_path).length) fail("unfinished_import_requires_review"); }
      const database_path = path.join(agent_path, "sessions.db");
      if (exists(database_path)) { ordinary(database_path); agents.push({ agent_id: name, relative_path: path.relative(root_path, database_path) }); }
      else if (["sessions", "archived-sessions"].some(partition => exists(path.join(agent_path, partition)))) fail("legacy_partition_requires_separate_conversion");
    }
    return agents;
  }

  /** 附件不移动；完整清单用于阻止在业务变化后覆盖恢复。 */
  function files_scope(root_path, agents) {
    return agents.map(agent => ({ agent_id: agent.agent_id,
      files: attachment_inventory(path.join(root_path, "agents", agent.agent_id, "session-files")) }));
  }

  /** 计划绑定不可变证据，发布/恢复确认与目标文件指纹由执行阶段另行核验。 */
  function plan_hash(manifest) {
    const { status: _status, plan_hash: _hash, artifacts, ...identity } = manifest;
    return digest({ ...identity, artifacts: artifacts.map(({ target_fingerprint: _target, published: _published, restored: _restored, ...item }) => item) });
  }

  /** 预检不初始化根或租约，仅输出完整结构、业务内容和附件的证据摘要。 */
  function preflight(root_path, runtime, historical) {
    assert_runtimes(runtime, historical); root_path = fs.realpathSync(root_path); ordinary(root_path, true);
    const original_marker = read_marker(root_path);
    if (original_marker && (original_marker.format_version !== source_schema || original_marker.state !== "ready")) fail(`source_root_is_not_ready_v${source_schema}`);
    const manifest = { format_version: target_schema, source_schema, target_schema, migration_policy,
      migration_id: random_uuid(), root_path, original_marker, status: "planned", agents: discover(root_path), artifacts: [], files: [], blockers: [] };
    const identities = new Set();
    for (const agent of manifest.agents) {
      let database;
      try {
        database = open_source(inside(root_path, agent.relative_path));
        agent.proof = inspect_database(database, agent.agent_id, historical);
        for (const row of database.prepare("SELECT session_id FROM sessions").iterate()) {
          if (identities.has(row.session_id)) fail("session_storage_identity_conflict"); identities.add(row.session_id);
        }
        manifest.artifacts.push({ ...artifact("database", agent.relative_path, agent.proof.source_fingerprint), agent_id: agent.agent_id });
      } catch (error) { manifest.blockers.push({ agent_id: agent.agent_id, reason: diagnostic(error) }); }
      finally { database?.close(); }
    }
    manifest.files = files_scope(root_path, manifest.agents);
    if (!manifest.agents.length) manifest.blockers.push({ reason: `no_v${source_schema}_agent_databases` });
    if (manifest.blockers.length) manifest.status = "blocked";
    manifest.plan_hash = plan_hash(manifest); return manifest;
  }

  /** 批次与源根必须互不包含，包括尚未创建目录的规范父路径。 */
  function normalize_batch(root_path, batch_path, runtime) {
    const target = runtime.resolve_resource_root(batch_path);
    if (target === root_path || target.startsWith(`${root_path}${path.sep}`) || root_path.startsWith(`${target}${path.sep}`)) fail("batch_must_be_outside_data_root");
    return target;
  }

  /** 将只读计划保存到新的私有外部目录；已有批次不会被覆盖。 */
  function plan_batch(root_path, batch_path, runtime, historical) {
    const normalized = normalize_batch(fs.realpathSync(root_path), batch_path, runtime);
    if (exists(normalized)) fail("batch_directory_already_exists");
    const manifest = preflight(root_path, runtime, historical);
    fs.mkdirSync(normalized, { mode: 0o700 }); save_manifest(normalized, manifest); return manifest;
  }

  /** 校验批次版本、权限、路径、完整 Agent 范围与计划摘要，先于任何业务文件写入。 */
  function read_manifest(root_path, batch_path) {
    ordinary(batch_path, true); const manifest_path = path.join(batch_path, "manifest.json");
    if ((ordinary(manifest_path).mode | fs.statSync(batch_path).mode) & 0o077) fail("batch_requires_private_permissions");
    const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
    if (manifest.format_version !== target_schema || manifest.source_schema !== source_schema || manifest.target_schema !== target_schema
      || manifest.migration_policy !== migration_policy || manifest.root_path !== fs.realpathSync(root_path)
      || !uuid_pattern.test(manifest.migration_id ?? "") || !["planned", "blocked", "prepared", "publishing", "ready", "restoring", "restored"].includes(manifest.status)
      || ![manifest.agents, manifest.artifacts, manifest.files, manifest.blockers].every(Array.isArray)
      || manifest.plan_hash !== plan_hash(manifest)) fail("batch_identity_invalid");
    if (new Set(manifest.agents.map(agent => agent.agent_id)).size !== manifest.agents.length
      || new Set(manifest.artifacts.map(item => item.agent_id)).size !== manifest.artifacts.length
      || (manifest.status !== "blocked" && manifest.artifacts.length !== manifest.agents.length)
      || manifest.artifacts.some(item => !manifest.agents.some(agent => agent.agent_id === item.agent_id))) fail("batch_agent_scope_invalid");
    for (const agent of manifest.agents) {
      if (typeof agent.agent_id !== "string" || !agent.agent_id.trim() || agent.agent_id !== agent.agent_id.trim()
        || /[\\/\0]/u.test(agent.agent_id) || [".", ".."].includes(agent.agent_id)
        || agent.relative_path !== path.join("agents", agent.agent_id, "sessions.db")) fail("batch_artifact_invalid");
      const item = manifest.artifacts.find(item => item.agent_id === agent.agent_id);
      if (!item && manifest.status === "blocked") continue;
      if (!item || item.kind !== "database" || item.relative_path !== agent.relative_path || item.target_relative !== agent.relative_path
        || item.key !== digest(["database", agent.relative_path]) || item.source_fingerprint !== agent.proof?.source_fingerprint
        || !/^[a-f0-9]{64}$/u.test(item.source_fingerprint) || !/^[a-f0-9]{64}$/u.test(agent.proof?.content_sha256 ?? "")) fail("batch_artifact_invalid");
      inside(root_path, item.relative_path);
    }
    return manifest;
  }

  /** 只有本批次能继续其迁移状态，不复用历史迁移 ID。 */
  function owned_marker(manifest, marker, states) {
    return marker?.format_version === target_schema && marker.migration_id === manifest.migration_id
      && marker.migration_policy === migration_policy && states.includes(marker.state);
  }

  /** 发布清晰的根边界；最后一个数据库验收通过前不能写 ready。 */
  function write_marker(manifest, state) {
    save_json(path.join(manifest.root_path, marker_name), { format_version: target_schema, state,
      migration_id: manifest.migration_id, migration_policy }, true);
  }

  /** 完整数据根和附件范围在执行、验证及恢复期间必须保持一致。 */
  function assert_scope(manifest) {
    if (digest(discover(manifest.root_path)) !== digest(manifest.agents.map(({ agent_id, relative_path }) => ({ agent_id, relative_path })))) fail("agent_scope_changed");
    if (digest(files_scope(manifest.root_path, manifest.agents)) !== digest(manifest.files)) fail("attachments_changed");
  }

  /** 一次持有全部 Agent 文件租约；失败时逆序释放已获得的连接。 */
  function acquire_leases(manifest, runtime) {
    const leases = [];
    try {
      for (const agent of manifest.agents) leases.push(runtime.AgentSessionFileLease.acquire(inside(manifest.root_path, agent.relative_path), agent.agent_id, true, true));
      return leases;
    } catch (error) { for (const lease of leases.reverse()) lease.release(); throw error; }
  }

  /** 核验原始备份与所有已发布目标；任何后续业务写入都会拒绝覆盖恢复。 */
  function verify_artifacts(manifest, batch_path, runtime) {
    assert_scope(manifest);
    for (const item of manifest.artifacts) {
      if (fingerprint_file(batch_file(batch_path, "original", item)) !== item.source_fingerprint) fail("original_backup_changed");
      const target = inside(manifest.root_path, item.relative_path);
      if (fingerprint_file(target) !== item.target_fingerprint) fail("published_target_changed_or_business_write");
      const database = open_source(target);
      try {
        assert_protocol_database(database, item.agent_id, runtime);
        if (content_digest(database) !== manifest.agents.find(agent => agent.agent_id === item.agent_id).proof.content_sha256) fail("converted_business_content_mismatch");
      } finally { database.close(); }
    }
  }

  /** 先全部备份，再全部转换验证，最后发布；中断后只接受同一计划和源/目标指纹。 */
  async function migrate(root_path, batch_path, runtime, historical) {
    assert_runtimes(runtime, historical); root_path = fs.realpathSync(root_path); batch_path = normalize_batch(root_path, batch_path, runtime);
    const manifest = read_manifest(root_path, batch_path);
    if (manifest.blockers.length || !["planned", "prepared", "publishing", "ready"].includes(manifest.status)) fail("batch_not_applicable");
    const root_lease = runtime.RootLease.acquire_write(root_path); let leases = [];
    try {
      assert_scope(manifest); leases = acquire_leases(manifest, runtime);
      if (manifest.status === "ready") return verify_batch(root_path, batch_path, runtime, historical);
      if (manifest.status === "planned") {
        if (digest(read_marker(root_path)) !== digest(manifest.original_marker)) fail("root_marker_changed");
        for (const item of manifest.artifacts) {
          if (fingerprint_file(inside(root_path, item.relative_path)) !== item.source_fingerprint) fail("source_changed_since_preflight");
          await backup_artifact(root_path, batch_path, item);
        }
        fs.mkdirSync(path.join(batch_path, "staged"), { recursive: true, mode: 0o700 });
        for (const item of manifest.artifacts) {
          const staged = batch_file(batch_path, "staged", item);
          // 未发布 stage 属于本批次，可从已验证原始备份重新生成。
          for (const suffix of ["", "-wal", "-shm"]) if (exists(`${staged}${suffix}`)) { ordinary(`${staged}${suffix}`); fs.unlinkSync(`${staged}${suffix}`); }
          const proof = manifest.agents.find(agent => agent.agent_id === item.agent_id).proof;
          await convert_database(batch_file(batch_path, "original", item), staged, item.agent_id, historical, runtime, proof);
          sync_path(staged); sync_path(path.dirname(staged)); item.target_fingerprint = fingerprint_file(staged);
        }
        manifest.status = "prepared"; save_manifest(batch_path, manifest);
      }
      const marker = read_marker(root_path);
      if (manifest.status === "prepared") {
        if (!owned_marker(manifest, marker, ["migrating"]) && digest(marker) !== digest(manifest.original_marker)) fail("root_marker_changed");
        for (const item of manifest.artifacts) if (fingerprint_file(inside(root_path, item.relative_path)) !== item.source_fingerprint) fail("source_changed_since_preflight");
        assert_scope(manifest); write_marker(manifest, "migrating"); manifest.status = "publishing"; save_manifest(batch_path, manifest);
      } else if (!owned_marker(manifest, marker, ["migrating", "ready"])) fail("root_marker_owned_by_another_batch");
      for (const item of manifest.artifacts) {
        if (fingerprint_file(batch_file(batch_path, "original", item)) !== item.source_fingerprint) fail("original_backup_changed");
        publish_file(root_path, batch_path, item); item.published = true; save_manifest(batch_path, manifest);
      }
      verify_artifacts(manifest, batch_path, runtime);
      write_marker(manifest, "ready"); manifest.status = "ready"; save_manifest(batch_path, manifest); return manifest;
    } finally { for (const lease of leases.reverse()) lease.release(); root_lease.release(); }
  }

  /** 只读验收已完成批次，不创建租约、checkpoint 或修复原始数据。 */
  function verify_batch(root_path, batch_path, runtime, historical) {
    assert_runtimes(runtime, historical); const manifest = read_manifest(root_path, batch_path);
    if (manifest.status !== "ready" || !owned_marker(manifest, read_marker(root_path), ["ready"])) fail("batch_not_ready");
    verify_artifacts(manifest, batch_path, runtime); return { ...manifest, status: "verified" };
  }

  /** 恢复只允许尚无业务或附件变化的完成批次；原始副本和审阅证据永久保留。 */
  function restore_batch(root_path, batch_path, runtime, historical) {
    assert_runtimes(runtime, historical); root_path = fs.realpathSync(root_path); batch_path = normalize_batch(root_path, batch_path, runtime);
    const manifest = read_manifest(root_path, batch_path);
    const root_lease = runtime.RootLease.acquire_write(root_path); let leases = [];
    try {
      assert_scope(manifest); leases = acquire_leases(manifest, runtime);
      if (manifest.status === "restored") {
        if (digest(read_marker(root_path)) !== digest(manifest.original_marker)) fail("root_marker_changed");
        for (const item of manifest.artifacts) if (fingerprint_file(inside(root_path, item.relative_path)) !== item.source_fingerprint) fail("restored_source_mismatch");
        return manifest;
      }
      if (!["ready", "restoring"].includes(manifest.status)) fail("restore_requires_completed_batch");
      const marker = read_marker(root_path);
      if (manifest.status === "ready") {
        if (!owned_marker(manifest, marker, ["ready", "restoring"])) fail("root_marker_owned_by_another_batch");
        verify_artifacts(manifest, batch_path, runtime); write_marker(manifest, "restoring"); manifest.status = "restoring"; save_manifest(batch_path, manifest);
      } else if (!owned_marker(manifest, marker, ["restoring"]) && digest(marker) !== digest(manifest.original_marker)) fail("root_marker_owned_by_another_batch");
      for (const item of manifest.artifacts) {
        if (fingerprint_file(batch_file(batch_path, "original", item)) !== item.source_fingerprint) fail("original_backup_changed");
        if (![item.source_fingerprint, item.target_fingerprint].includes(fingerprint_file(inside(root_path, item.relative_path)))) fail("target_changed_during_restore");
      }
      for (const item of manifest.artifacts) {
        if (fingerprint_file(inside(root_path, item.relative_path)) !== item.source_fingerprint) restore_artifact(root_path, batch_path, item);
        item.restored = true; save_manifest(batch_path, manifest);
      }
      if (manifest.original_marker) save_json(path.join(root_path, marker_name), manifest.original_marker, true);
      else { const marker_path = path.join(root_path, marker_name); if (exists(marker_path)) fs.unlinkSync(marker_path); sync_path(root_path); }
      manifest.status = "restored"; save_manifest(batch_path, manifest); return manifest;
    } finally { for (const lease of leases.reverse()) lease.release(); root_lease.release(); }
  }

  return { preflight, plan_batch, migrate, read_manifest, verify_batch, restore_batch };
}
