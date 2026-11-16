/**
 * Isolated GroupSession metadata conversion, independent of Agent databases and transfers.
 *
 * All identity comes from existing metadata. Directory names only check location consistency.
 * A complete byte snapshot precedes backup creation; publication changes only metadata files.
 * Each rename is atomic, not the whole batch. Resume accepts only original or planned bytes,
 * checks the entire inventory, and never overwrites subsequent business writes. Writers must
 * remain stopped. A root lease blocks concurrent migrators; a crash leaves it for operator review.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const lease_name = ".group-session-v2.lock";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (reason) => { throw new Error(reason); };
const is_record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const is_id = (value) => typeof value === "string" && Boolean(value.trim());

/** Require an explicitly selected canonical directory, without symbolic path components. */
export function resolve_root(input) {
  if (!input || !path.isAbsolute(input)) fail("group_root_requires_absolute_path");
  const resolved = path.resolve(input);
  if (fs.realpathSync(resolved) !== resolved || !fs.lstatSync(resolved).isDirectory()) fail("group_root_not_canonical_directory");
  return resolved;
}

/** Snapshot all files and empty directories, rejecting symlinks and runtime locks. */
function snapshot(root_path, allow_lease = false) {
  const inventory = [];
  const contents = new Map();
  function visit(relative_path) {
    const absolute_path = path.join(root_path, relative_path);
    const info = fs.lstatSync(absolute_path);
    if (info.isSymbolicLink()) fail("group_source_symlink");
    if (info.isDirectory()) {
      inventory.push({ path: relative_path, kind: "directory" });
      for (const name of fs.readdirSync(absolute_path).sort()) {
        if (allow_lease && !relative_path && name === lease_name) continue;
        if (name === ".lock" || name === lease_name) fail("group_source_locked");
        visit(path.join(relative_path, name));
      }
    } else if (info.isFile()) {
      const bytes = fs.readFileSync(absolute_path);
      inventory.push({ path: relative_path, kind: "file", sha256: digest(bytes), mode: info.mode & 0o777 });
      contents.set(relative_path, bytes);
    } else fail("group_source_special_file");
  }
  visit("");
  return { inventory, contents };
}

/** Validate v1/v2 fields without deriving identity, time, counters or dispatch state. */
function validate_metadata(value) {
  if (!is_record(value) || ![1, 2].includes(value.v)) fail("group_metadata_version_invalid");
  if (!is_id(value.group_id) || !is_id(value.session_id)) fail("group_metadata_ownership_unproven");
  for (const field of ["created_at", "updated_at"]) {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] < 0) fail(`group_metadata_${field}_invalid`);
  }
  if (!Number.isSafeInteger(value.message_count) || value.message_count < 0) fail("group_metadata_message_count_invalid");
  if (value.workspace_id !== undefined && !is_id(value.workspace_id)) fail("group_metadata_workspace_invalid");
  for (const field of ["title", "preview_text"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") fail(`group_metadata_${field}_invalid`);
  }
  if (value.member_session_ids !== undefined && (!is_record(value.member_session_ids)
    || Object.entries(value.member_session_ids).some(([key, id]) => !is_id(key) || !is_id(id)))) fail("group_metadata_members_invalid");
  if (value.pending_message_ids !== undefined && (!Array.isArray(value.pending_message_ids)
    || value.pending_message_ids.some((id) => !is_id(id)))) fail("group_metadata_pending_invalid");
  if (value.pending_turns !== undefined && (!is_record(value.pending_turns) || Object.keys(value.pending_turns).length)) fail("group_pending_legacy_dispatch");
}

/** Build a deterministic plan solely from original source bytes. */
function inspect(root_path, source) {
  const changes = [];
  let group_id;
  let session_count = 0;
  for (const area of ["sessions", "archived-sessions"]) {
    const area_entry = source.inventory.find((item) => item.path === area);
    if (!area_entry) continue;
    if (area_entry.kind !== "directory") fail("group_area_not_directory");
    const sessions = source.inventory.filter((item) => path.dirname(item.path) === area);
    for (const session of sessions) {
      if (session.kind !== "directory") fail("group_session_not_directory");
      const meta_path = path.join(session.path, "meta.json");
      const original = source.contents.get(meta_path);
      if (!original) fail("group_session_metadata_not_found");
      const value = JSON.parse(original.toString("utf8"));
      validate_metadata(value);
      if (encodeURIComponent(value.session_id) !== path.basename(session.path)) fail("group_session_location_conflict");
      if (group_id !== undefined && value.group_id !== group_id) fail("group_metadata_group_conflict");
      group_id = value.group_id;
      const messages_path = path.join(session.path, "messages.jsonl");
      const messages = source.contents.get(messages_path);
      if (!messages && value.message_count > 0) fail("group_session_messages_not_found");
      for (const line of (messages?.toString("utf8") ?? "").split("\n")) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (!is_record(message) || message.group_id !== value.group_id) fail("group_message_ownership_conflict");
      }
      session_count += 1;
      if (value.v === 1) {
        const target = `${JSON.stringify({ ...value, v: 2, pending_message_ids: value.pending_message_ids ?? [] }, null, 2)}\n`;
        changes.push({ path: meta_path, original_sha256: digest(original), target_sha256: digest(target), target });
      }
    }
  }
  const plan = { format: 1, root_path, group_id: group_id ?? null, session_count, inventory: source.inventory,
    changes: changes.map(({ target, ...item }) => item) };
  return { plan, plan_hash: digest(JSON.stringify(plan)), changes };
}

/** Read-only preflight; returns hashes and identities, never creates an output directory. */
export function preflight(root_path) {
  const source = snapshot(root_path);
  const result = inspect(root_path, source);
  return { ...result.plan, plan_hash: result.plan_hash };
}

/** Ensure every source path is original or an already published target of this exact batch. */
function assert_source(source, original, changes, allow_targets) {
  const targets = new Map(changes.map((item) => [item.path, item.target_sha256]));
  if (source.inventory.length !== original.inventory.length) fail("group_source_changed");
  for (let index = 0; index < source.inventory.length; index += 1) {
    const current = source.inventory[index];
    const before = original.inventory[index];
    if (current.path !== before.path || current.kind !== before.kind || current.mode !== before.mode) fail("group_source_changed");
    if (current.sha256 !== before.sha256 && !(allow_targets && current.sha256 === targets.get(current.path))) fail("group_source_changed");
  }
}

/** Sync a private, exclusively created file before publication. */
function write_exclusive(file_path, bytes, mode = 0o600) {
  const fd = fs.openSync(file_path, "wx", mode);
  try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** Flush directory entries after a rename or durable manifest write. */
function sync_directory(directory_path) {
  const fd = fs.openSync(directory_path, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** Backup is a new sibling/outside directory; existing contents are never adopted implicitly. */
function resolve_backup(root_path, input, resume) {
  if (!input || !path.isAbsolute(input)) fail("group_backup_requires_absolute_path");
  const backup_path = path.resolve(input);
  if (backup_path === root_path || backup_path.startsWith(`${root_path}${path.sep}`)
    || root_path.startsWith(`${backup_path}${path.sep}`)) fail("group_backup_overlaps_source");
  if (resume) return resolve_root(backup_path);
  if (fs.existsSync(backup_path)) fail("group_backup_already_exists");
  if (fs.realpathSync(path.dirname(backup_path)) !== path.dirname(backup_path)) fail("group_backup_parent_not_canonical");
  return backup_path;
}

/**
 * Convert only after a matching preflight hash and explicit writer shutdown declaration.
 * Resume authenticates the plan against the complete original backup, then checks live bytes.
 * A partially created backup without a manifest has never published source changes.
 */
export function apply_conversion({ root_path, backup, expect, resume = false, writers_stopped = false }) {
  if (!writers_stopped) fail("group_writers_must_be_stopped");
  if (!/^[a-f0-9]{64}$/u.test(expect ?? "")) fail("group_expected_plan_hash_required");
  const backup_path = resolve_backup(root_path, backup, resume);
  let original;
  let result;
  if (resume) {
    const manifest_path = path.join(backup_path, "manifest.json");
    if (fs.lstatSync(manifest_path).isSymbolicLink()) fail("group_backup_manifest_symlink");
    const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
    original = snapshot(resolve_root(path.join(backup_path, "source")));
    result = inspect(root_path, original);
    if (JSON.stringify(manifest) !== JSON.stringify({ ...result.plan, plan_hash: result.plan_hash })) fail("group_backup_manifest_conflict");
  } else {
    original = snapshot(root_path);
    result = inspect(root_path, original);
  }
  if (result.plan_hash !== expect) fail("group_plan_changed");
  assert_source(snapshot(root_path), original, result.changes, resume);
  if (!resume) {
    fs.mkdirSync(backup_path, { mode: 0o700 });
    const saved_root = path.join(backup_path, "source");
    fs.mkdirSync(saved_root, { mode: 0o700 });
    for (const entry of original.inventory) {
      if (!entry.path) continue;
      const destination = path.join(saved_root, entry.path);
      if (entry.kind === "directory") fs.mkdirSync(destination, { mode: 0o700 });
      else write_exclusive(destination, original.contents.get(entry.path), entry.mode);
    }
    const saved = snapshot(saved_root);
    assert_source(saved, original, [], false);
    write_exclusive(path.join(backup_path, "manifest.json"), `${JSON.stringify({ ...result.plan, plan_hash: result.plan_hash }, null, 2)}\n`);
    for (const entry of [...original.inventory].reverse().filter((item) => item.kind === "directory")) sync_directory(path.join(saved_root, entry.path));
    sync_directory(backup_path);
    sync_directory(path.dirname(backup_path));
  }
  const lease_path = path.join(root_path, lease_name);
  const token = `${process.pid}:${randomUUID()}`;
  write_exclusive(lease_path, token);
  try {
    assert_source(snapshot(root_path, true), original, result.changes, resume);
    for (const change of result.changes) {
      assert_source(snapshot(root_path, true), original, result.changes, true);
      const destination = path.join(root_path, change.path);
      if (digest(fs.readFileSync(destination)) === change.target_sha256) continue;
      const temporary = path.join(path.dirname(destination), `.group-v2-${randomUUID()}.tmp`);
      try {
        write_exclusive(temporary, change.target, fs.statSync(destination).mode & 0o777);
        if (digest(fs.readFileSync(destination)) !== change.original_sha256) fail("group_source_changed");
        fs.renameSync(temporary, destination);
        sync_directory(path.dirname(destination));
      } finally { fs.rmSync(temporary, { force: true }); }
    }
    const final = snapshot(root_path, true);
    assert_source(final, original, result.changes, true);
    for (const change of result.changes) {
      if (digest(final.contents.get(change.path)) !== change.target_sha256) fail("group_conversion_incomplete");
    }
  } finally {
    if (fs.readFileSync(lease_path, "utf8") === token) fs.unlinkSync(lease_path);
  }
  return { root_path, backup_path, plan_hash: result.plan_hash, converted: result.changes.length, session_count: result.plan.session_count };
}
