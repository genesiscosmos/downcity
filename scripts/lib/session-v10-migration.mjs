/**
 * 可审阅的 v9→v10 离线根迁移。预检不写源根，默认保留证据，恢复需显式选择。
 * apply 持根和全部 Agent 租约，先完整备份再暂存，以批次所属标记隔离发布中间态。
 * 源/目标指纹保证发布和恢复可重入，并拒绝覆盖后续业务写入。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID as random_uuid } from "node:crypto";
import { digest, fail } from "./session-v7-database.mjs";
import { exists, ordinary, inside, save_json, sync_path, attachment_inventory, diagnostic } from "./session-v8-files.mjs";
import { open_source, database_fingerprint, fingerprint_file } from "./session-v9-database.mjs";
import { artifact, backup_artifact, batch_file, publish_file, restore_artifact, save_manifest } from "./session-v9-batch.mjs";
import { inspect_database, terminal_policy, validate_target } from "./session-v10-proof.mjs";
import { convert_database } from "./session-v10-conversion.mjs";
import { uuid_pattern } from "./session-v9-identities.mjs";
import { recovery_policy, assert_terminal_policy } from "./session-v10-recovery.mjs";

const marker_name = "session-storage.json";

/** Reject accidental use of current or historical bridges in the opposite role. */
function assert_runtimes(runtime, historical) {
  if (runtime.AGENT_SESSION_SCHEMA_VERSION !== 10 || historical.AGENT_SESSION_SCHEMA_VERSION !== 9) fail("v10_conversion_runtime_mismatch");
}

/** Read only a normal marker; source roots may be unmarked but cannot be in another batch. */
function read_marker(root_path) {
  const marker_path = path.join(root_path, marker_name);
  if (!exists(marker_path)) return null;
  ordinary(marker_path); return JSON.parse(fs.readFileSync(marker_path, "utf8"));
}

/** Exact Agent database scope, without following links or taking over unfinished imports. */
function discover(root_path) {
  const directory = path.join(root_path, "agents"); ordinary(directory, true);
  const agents = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const agent_path = path.join(directory, name); ordinary(agent_path, true);
    const imports_path = path.join(agent_path, ".session-imports");
    if (exists(imports_path)) { ordinary(imports_path, true); if (fs.readdirSync(imports_path).length) fail("unfinished_import_requires_review"); }
    const database_path = path.join(agent_path, "sessions.db");
    if (exists(database_path)) { ordinary(database_path); agents.push({ agent_id: name, relative_path: path.relative(root_path, database_path) }); }
    else if (["sessions", "archived-sessions"].some(name => exists(path.join(agent_path, name)))) fail("legacy_partition_requires_separate_conversion");
  }
  return agents;
}

/** Attachment ownership and payloads are unchanged; hash their full trees as restore guards. */
function files_scope(root_path, agents) {
  return agents.map(agent => ({ agent_id: agent.agent_id,
    files: attachment_inventory(path.join(root_path, "agents", agent.agent_id, "session-files")) }));
}

/** Plan digest binds the policy, evidence, source scope and paths, excluding mutable ACKs. */
function plan_hash(manifest) {
  return digest({ policy: manifest.terminal_policy, source_schema: manifest.source_schema, target_schema: manifest.target_schema,
    migration_id: manifest.migration_id, root_path: manifest.root_path, original_marker: manifest.original_marker,
    agents: manifest.agents, files: manifest.files, blockers: manifest.blockers,
    artifacts: manifest.artifacts.map(({ target_fingerprint: _target, published: _published, restored: _restored, ...item }) => item) });
}

/** Public read-only inspection: list every Tool's evidence and stable/checkpoint impact. */
export function preflight(root_path, runtime, historical, recover_reviewed = false) {
  assert_runtimes(runtime, historical); root_path = fs.realpathSync(root_path); ordinary(root_path, true);
  const original_marker = read_marker(root_path);
  if (original_marker && (original_marker.format_version !== 9 || original_marker.state !== "ready")) fail("source_root_is_not_ready_v9");
  const policy = recover_reviewed ? recovery_policy : terminal_policy;
  const manifest = { format_version: 10, source_schema: 9, target_schema: 10, terminal_policy: policy,
    migration_id: random_uuid(), root_path, original_marker, status: "planned", agents: discover(root_path), artifacts: [], files: [], blockers: [] };
  const identities = new Set();
  for (const agent of manifest.agents) {
    const database = open_source(inside(root_path, agent.relative_path));
    try {
      const proof = inspect_database(database, agent.agent_id, historical, runtime, policy);
      Object.assign(agent, proof, { source_fingerprint: database_fingerprint(database) });
      if (recover_reviewed) agent.proof_sha256 = digest(proof);
      manifest.blockers.push(...proof.blockers.map(blocker => ({ agent_id: agent.agent_id, ...blocker })));
      for (const row of database.prepare("SELECT session_id FROM sessions").iterate()) {
        if (identities.has(row.session_id)) fail("session_storage_identity_conflict"); identities.add(row.session_id);
      }
      manifest.artifacts.push({ ...artifact("database", agent.relative_path, agent.source_fingerprint), agent_id: agent.agent_id });
    } catch (error) { manifest.blockers.push({ agent_id: agent.agent_id, reason: diagnostic(error) }); }
    finally { database.close(); }
  }
  manifest.files = files_scope(root_path, manifest.agents);
  if (!manifest.agents.length) manifest.blockers.push({ reason: "no_v9_agent_databases" });
  if (manifest.blockers.length) manifest.status = "blocked";
  manifest.plan_hash = plan_hash(manifest);
  return manifest;
}

/** A private, external, new batch is the explicit plan reviewed before apply. */
export function plan_batch(root_path, batch_path, runtime, historical, recover_reviewed = false) {
  const normalized = normalize_batch(fs.realpathSync(root_path), batch_path, runtime);
  if (exists(normalized)) fail("batch_directory_already_exists");
  const manifest = preflight(root_path, runtime, historical, recover_reviewed);
  fs.mkdirSync(normalized, { mode: 0o700 }); save_json(path.join(normalized, "manifest.json"), manifest);
  return manifest;
}

/** Keep batch/root mutually disjoint, including nonexistent output parents. */
function normalize_batch(root_path, batch_path, runtime) {
  const target = runtime.resolve_resource_root(batch_path);
  if (target === root_path || target.startsWith(`${root_path}${path.sep}`) || root_path.startsWith(`${target}${path.sep}`)) fail("batch_must_be_outside_data_root");
  return target;
}

/** Version/policy/path checks precede any backup, publication or restore. */
export function read_manifest(root_path, batch_path) {
  ordinary(batch_path, true); const manifest_path = path.join(batch_path, "manifest.json");
  if ((ordinary(manifest_path).mode | fs.statSync(batch_path).mode) & 0o077) fail("batch_requires_private_permissions");
  const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
  if (manifest.format_version !== 10 || manifest.source_schema !== 9 || manifest.target_schema !== 10) fail("batch_terminal_policy_requires_review");
  assert_terminal_policy(manifest.terminal_policy);
  if (manifest.root_path !== fs.realpathSync(root_path) || !uuid_pattern.test(manifest.migration_id)
    || !["planned", "blocked", "prepared", "publishing", "ready", "restoring", "restored"].includes(manifest.status)
    || !Array.isArray(manifest.agents) || !Array.isArray(manifest.artifacts) || !Array.isArray(manifest.files)
    || !Array.isArray(manifest.blockers) || manifest.plan_hash !== plan_hash(manifest)) fail("batch_identity_invalid");
  if (new Set(manifest.agents.map(agent => agent.agent_id)).size !== manifest.agents.length
    || new Set(manifest.artifacts.map(item => item.agent_id)).size !== manifest.artifacts.length
    || manifest.artifacts.some(item => !manifest.agents.some(agent => agent.agent_id === item.agent_id))
    || (manifest.status !== "blocked" && manifest.artifacts.length !== manifest.agents.length)) fail("batch_agent_scope_invalid");
  for (const agent of manifest.agents) {
    const item = manifest.artifacts.find(item => item.agent_id === agent.agent_id);
    if (!item && manifest.status === "blocked") continue;
    if (manifest.terminal_policy === recovery_policy && !/^[a-f0-9]{64}$/u.test(agent.proof_sha256 ?? "")) fail("batch_recovery_proof_missing");
    if (typeof agent.agent_id !== "string" || !agent.agent_id || /[\\/\0]/u.test(agent.agent_id) || [".", ".."].includes(agent.agent_id)
      || agent.relative_path !== path.join("agents", agent.agent_id, "sessions.db") || item.agent_id !== agent.agent_id
      || item.relative_path !== agent.relative_path || item.target_relative !== agent.relative_path || item.kind !== "database"
      || item.key !== digest(["database", agent.relative_path]) || item.source_fingerprint !== agent.source_fingerprint
      || !/^[a-f0-9]{64}$/u.test(item.source_fingerprint)) fail("batch_artifact_invalid");
    inside(root_path, item.relative_path);
  }
  return manifest;
}

/** Root marker ownership prevents resuming another batch or interpreting a different policy. */
function owned_marker(manifest, marker, states) {
  return marker?.format_version === 10 && marker.migration_id === manifest.migration_id
    && marker.terminal_policy === manifest.terminal_policy && states.includes(marker.state);
}

/** Publish only a complete, explicitly owned readiness state. */
function write_marker(manifest, state) {
  save_json(path.join(manifest.root_path, marker_name), { format_version: 10, state,
    migration_id: manifest.migration_id, terminal_policy: manifest.terminal_policy }, true);
}

/** All unchanged filesystem scope remains bound throughout apply, verify and restore. */
function assert_scope(manifest) {
  if (digest(discover(manifest.root_path)) !== digest(manifest.agents.map(({ agent_id, relative_path }) => ({ agent_id, relative_path })))) fail("agent_scope_changed");
  if (digest(files_scope(manifest.root_path, manifest.agents)) !== digest(manifest.files)) fail("attachments_changed");
}

/** Acquire all Agent file leases together; release already acquired leases on failure. */
function acquire_leases(manifest, runtime) {
  const leases = [];
  try {
    for (const agent of manifest.agents) leases.push(runtime.AgentSessionFileLease.acquire(inside(manifest.root_path, agent.relative_path), agent.agent_id, true, true));
    return leases;
  } catch (error) { for (const lease of leases.reverse()) lease.release(); throw error; }
}

/** 只执行策略一致且无阻断的审阅计划；备份及 stage 完成后才触碰正式发布标记。 */
export async function migrate(root_path, batch_path, runtime, historical, recover_reviewed = false) {
  assert_runtimes(runtime, historical); root_path = fs.realpathSync(root_path); batch_path = normalize_batch(root_path, batch_path, runtime);
  const manifest = read_manifest(root_path, batch_path);
  if ((manifest.terminal_policy === recovery_policy) !== recover_reviewed) fail("batch_recovery_policy_confirmation_mismatch");
  if (manifest.blockers.length || !["planned", "prepared", "publishing", "ready"].includes(manifest.status)) fail("v10_first_disclosure_unproven_or_batch_not_applicable");
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
        if (exists(staged)) { ordinary(staged); fs.unlinkSync(staged); }
        const agent = manifest.agents.find(agent => agent.agent_id === item.agent_id);
        await convert_database(batch_file(batch_path, "original", item), staged, item.agent_id, historical, runtime,
          { terminal_policy: manifest.terminal_policy, proof_sha256: agent.proof_sha256 });
        sync_path(staged); sync_path(path.dirname(staged)); item.target_fingerprint = fingerprint_file(staged);
      }
      manifest.status = "prepared"; save_manifest(batch_path, manifest);
    }
    const marker = read_marker(root_path);
    if (manifest.status === "prepared") {
      if (!owned_marker(manifest, marker, ["migrating"]) && digest(marker) !== digest(manifest.original_marker)) fail("root_marker_changed");
      for (const item of manifest.artifacts) if (fingerprint_file(inside(root_path, item.relative_path)) !== item.source_fingerprint) fail("source_changed_since_preflight");
      assert_scope(manifest); write_marker(manifest, "migrating");
      manifest.status = "publishing"; save_manifest(batch_path, manifest);
    } else if (!owned_marker(manifest, marker, ["migrating", "ready"])) fail("root_marker_owned_by_another_batch");
    for (const item of manifest.artifacts) {
      if (fingerprint_file(batch_file(batch_path, "original", item)) !== item.source_fingerprint) fail("original_backup_changed");
      publish_file(root_path, batch_path, item); item.published = true; save_manifest(batch_path, manifest);
    }
    verify_artifacts(manifest, batch_path, runtime);
    write_marker(manifest, "ready"); manifest.status = "ready"; save_manifest(batch_path, manifest);
    return manifest;
  } finally { for (const lease of leases.reverse()) lease.release(); root_lease.release(); }
}

/** Exact targets and backups are checked even when a previous publication ACK was saved. */
function verify_artifacts(manifest, batch_path, runtime) {
  assert_scope(manifest);
  for (const item of manifest.artifacts) {
    if (fingerprint_file(batch_file(batch_path, "original", item)) !== item.source_fingerprint) fail("original_backup_changed");
    const target = inside(manifest.root_path, item.relative_path);
    if (fingerprint_file(target) !== item.target_fingerprint) fail("published_target_changed_or_business_write");
    const database = open_source(target);
    try { validate_target(database, item.agent_id, runtime); } finally { database.close(); }
  }
}

/** Read-only verification, with no lease preparation, repair or checkpoint writes. */
export function verify_batch(root_path, batch_path, runtime, historical) {
  assert_runtimes(runtime, historical); const manifest = read_manifest(root_path, batch_path);
  if (manifest.status !== "ready" || !owned_marker(manifest, read_marker(root_path), ["ready"])) fail("batch_not_ready");
  verify_artifacts(manifest, batch_path, runtime); return { ...manifest, status: "verified" };
}

/** Restore only before any business change, retaining backups and exact original marker. */
export function restore_batch(root_path, batch_path, runtime, historical) {
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
      verify_artifacts(manifest, batch_path, runtime);
      write_marker(manifest, "restoring"); manifest.status = "restoring"; save_manifest(batch_path, manifest);
    } else if (!owned_marker(manifest, marker, ["restoring"]) && digest(marker) !== digest(manifest.original_marker)) fail("root_marker_owned_by_another_batch");
    for (const item of manifest.artifacts) {
      if (fingerprint_file(batch_file(batch_path, "original", item)) !== item.source_fingerprint) fail("original_backup_changed");
      const fingerprint = fingerprint_file(inside(root_path, item.relative_path));
      if (![item.source_fingerprint, item.target_fingerprint].includes(fingerprint)) fail("target_changed_during_restore");
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
