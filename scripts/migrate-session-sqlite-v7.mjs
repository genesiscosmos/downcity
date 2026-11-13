/**
 * @file Independent, default-read-only Session v5/v6 -> v7 offline migration CLI.
 *
 * Run from a source checkout with Node >= 22.18 and installed workspace dependencies.
 * --apply requires --backup-dir. Quit every Desktop/CLI/Agent writer before applying.
 * Every selected library is preflighted before any source mutation. Each source database
 * commits independently; a failure stops the batch with explicit remaining statuses.
 * Backups use SQLite's online backup API (including WAL), are verified against preflight,
 * and are never overwritten. Only disposable backup working copies are transformed first.
 * Reports contain IDs, counts, hashes and fixed diagnostics; no input bodies or secrets.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync, backup } from "node:sqlite";
import { createHash as create_hash } from "node:crypto";
import { fileURLToPath as file_url_to_path } from "node:url";
import { load_runtime } from "./lib/session-v7-runtime.mjs";
import { fail, open_readonly, snapshot_file, target_descriptor, validate_target, validate_plan, import_plan } from "./lib/session-v7-database.mjs";
import { plan_snapshot } from "./lib/session-v7-plan.mjs";
import { load_repair_manifest } from "./lib/session-v7-repairs.mjs";

const help_text = `Session offline migration (fixed target v7; Node >= 22.18)
node scripts/migrate-session-sqlite-v7.mjs [--dry-run | --apply] [options]
  --root PATH        Downcity data root (default: ~/.downcity)
  --agent ID         Select one Agent
  --session ID       Select one Session (use --agent to disambiguate)
  --category NAME    Select one category in the selected partitions
  --partition NAME   sessions or archived-sessions (default: both)
  --backup-dir PATH  Mandatory for --apply; a fresh private batch is created here
  --repair-manifest PATH  Private, reviewed exact repairs; stale/unused entries block
  --report PATH      Write a private JSON report; refuses an existing destination
  --help             Show this help without opening any database
Default is dry-run. Apply only after ALL writers have exited. No backup bypass.
Any blocker, lock, failure or incomplete batch exits nonzero. No automatic restore.`;

/** Parse a closed CLI interface; typos and missing values cannot broaden selection. */
export function parse_arguments(arguments_) {
  const input = { root_path: path.join(os.homedir(), ".downcity"), apply: false };
  const names = { "--root": "root_path", "--agent": "agent_id", "--session": "session_id", "--category": "category", "--partition": "partition", "--backup-dir": "backup_directory", "--report": "report_path", "--repair-manifest": "repair_manifest_path" };
  const seen = new Set();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (seen.has(argument)) fail("duplicate_argument");
    seen.add(argument);
    if (argument === "--help") input.help = true;
    else if (argument === "--apply") input.apply = true;
    else if (argument === "--dry-run") input.apply = false;
    else if (names[argument]) {
      const value = arguments_[++index];
      if (!value || value.startsWith("--")) fail("missing_argument_value");
      input[names[argument]] = value;
    } else fail("unknown_argument");
  }
  if (seen.has("--apply") && seen.has("--dry-run")) fail("conflicting_modes");
  if (input.apply && !input.backup_directory && !input.help) fail("apply_requires_backup_directory");
  if (input.partition && !["sessions", "archived-sessions"].includes(input.partition)) fail("invalid_partition_filter");
  for (const name of ["agent_id", "session_id", "category"]) {
    if (input[name] && (/[\\/\u0000]/u.test(input[name]) || [".", ".."].includes(input[name]) || input[name].startsWith("."))) fail("invalid_scope_filter");
  }
  return input;
}

/** Enumerate exactly agents/ID/{sessions,archived-sessions}/CATEGORY/ID/session.db. */
function find_databases(root_path, input) {
  const directories = directory => fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).map(entry => entry.name).sort();
  const agents_path = path.join(root_path, "agents");
  const output = [];
  for (const agent_id of directories(agents_path)) {
    if (input.agent_id && input.agent_id !== agent_id) continue;
    for (const partition of ["sessions", "archived-sessions"]) {
      if (input.partition && input.partition !== partition) continue;
      const partition_path = path.join(agents_path, agent_id, partition);
      if (!fs.existsSync(partition_path) || fs.lstatSync(partition_path).isSymbolicLink()) continue;
      for (const category of directories(partition_path)) {
        if (input.category && input.category !== category) continue;
        for (const session_id of directories(path.join(partition_path, category))) {
          if (input.session_id && input.session_id !== session_id) continue;
          const database_path = path.join(partition_path, category, session_id, "session.db");
          if (fs.existsSync(database_path)) output.push({ agent_id, session_id, category, partition, database_path, relative_path: path.relative(root_path, database_path) });
        }
      }
    }
  }
  return output;
}

/** Public error codes never include the raw SQLite/zod/parser diagnostic. */
function diagnostic(error) {
  if (error?.migration_code) return error.migration_code;
  if (/busy|locked/iu.test(String(error?.message))) return "database_locked";
  return "operation_failed_details_redacted";
}

/** Write new private JSON files exclusively; reports may include sensitive structural IDs. */
function write_private(file_path, value) {
  fs.mkdirSync(path.dirname(file_path), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file_path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

/** Atomically replace only a report created by this invocation, including after each commit. */
function update_report(report_path, result) {
  if (!report_path) return;
  const pending_path = `${report_path}.${process.pid}.pending`;
  write_private(pending_path, result);
  fs.renameSync(pending_path, report_path);
}

/** Validate the source is a single ordinary inode, not a link to another writable database. */
function source_identity(database_path) {
  const stat = fs.lstatSync(database_path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail("source_is_not_single_link_regular_file");
  return `${stat.dev}:${stat.ino}`;
}

/**
 * Create a standalone SQLite backup, compare its full logical fingerprint with preflight,
 * and validate a separate transformed working copy. Source connection stays read-only.
 */
async function prepare_backup(item, plan, batch_path, runtime, expected) {
  const original_path = path.join(batch_path, "original", item.relative_path);
  fs.mkdirSync(path.dirname(original_path), { recursive: true, mode: 0o700 });
  fs.closeSync(fs.openSync(original_path, "wx", 0o600));
  const source = open_readonly(item.database_path);
  try { await backup(source, original_path); }
  finally { source.close(); }
  fs.chmodSync(original_path, 0o400);
  if (snapshot_file(original_path).fingerprint !== plan.source_fingerprint) fail("backup_source_changed_since_preflight");
  const file_sha256 = create_hash("sha256").update(fs.readFileSync(original_path)).digest("hex");
  const manifest_path = path.join(batch_path, "manifests", `${item.relative_path}.json`);
  write_private(manifest_path, { ...plan.manifest, relative_path: item.relative_path, backup_path: original_path, backup_sha256: file_sha256 });
  const working_path = path.join(batch_path, "work", item.relative_path);
  fs.mkdirSync(path.dirname(working_path), { recursive: true, mode: 0o700 });
  fs.copyFileSync(original_path, working_path, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(working_path, 0o600);
  const working = new DatabaseSync(working_path);
  try { import_plan(working, plan, runtime, expected); }
  finally { working.close(); }
  const check = open_readonly(working_path);
  try { validate_target(check, runtime, expected); }
  finally { check.close(); }
  return { backup_path: original_path, backup_sha256: file_sha256, manifest_path, working_path };
}

/** Execute default read-only planning, or explicitly requested offline application. */
export async function migrate_session_sqlite_v7(input) {
  const repairs = load_repair_manifest(input.repair_manifest_path);
  const runtime = await load_runtime();
  const expected = target_descriptor(runtime);
  const root_path = fs.realpathSync(path.resolve(input.root_path));
  if (input.apply && !input.backup_directory) fail("apply_requires_backup_directory");
  const result = { target_version: 7, mode: input.apply ? "apply" : "dry-run", root_path, complete: false, databases: [] };
  const items = find_databases(root_path, input);
  const selected_paths = new Set(items.map(item => item.relative_path));
  const unused_paths = [...repairs.keys()].filter(relative_path => !selected_paths.has(relative_path));
  if (unused_paths.length) result.repair_errors = unused_paths.map(database_path => ({ database_path, reason: "unconsumed_repair_database" }));
  const plans = new Map();
  const identities = new Map();
  for (const item of items) {
    const record = { database_path: item.relative_path, status: "unprocessed" };
    result.databases.push(record);
    item.record = record;
    try {
      item.inode = source_identity(item.database_path);
      const snapshot = snapshot_file(item.database_path);
      record.from_version = snapshot.version;
      const identity = `${item.agent_id}\u0000${item.session_id}`;
      if (identities.has(identity)) {
        identities.get(identity).status = "blocked";
        identities.get(identity).reason = "duplicate_session_identity";
        fail("duplicate_session_identity");
      }
      identities.set(identity, record);
      const plan = plan_snapshot(snapshot, item, runtime, expected, repairs.get(item.relative_path));
      if (!plan) {
        const database = open_readonly(item.database_path);
        try { database.exec("BEGIN;"); validate_target(database, runtime, expected); }
        finally { database.close(); }
        record.status = "validated_v7_skipped";
      } else {
        validate_plan(plan, runtime, expected);
        plans.set(item.database_path, plan.source_fingerprint);
        record.status = "planned";
        record.plan = plan.manifest;
      }
    } catch (error) { record.status = "blocked"; record.reason = diagnostic(error); }
  }
  if (!items.length) result.reason = "no_matching_databases";
  if (input.report_path) {
    // Exclusive creation also prevents accidental overwrites of source DBs or old reports.
    input.report_path = path.resolve(input.report_path);
    write_private(input.report_path, result);
  }
  const blocked = Boolean(result.repair_errors?.length) || result.databases.some(record => record.status === "blocked");
  if (input.apply && items.length && !blocked && plans.size) {
    const backup_root = path.resolve(input.backup_directory);
    fs.mkdirSync(backup_root, { recursive: true, mode: 0o700 });
    // A unique batch never reuses or modifies an earlier original backup.
    const batch_path = fs.mkdtempSync(path.join(backup_root, "session-v7-"));
    fs.chmodSync(batch_path, 0o700);
    result.backup_batch = batch_path;
    const batch_report = path.join(batch_path, "report.json");
    write_private(batch_report, result);
    for (const item of items) {
      if (item.record.status !== "planned") continue;
      try {
        const snapshot = snapshot_file(item.database_path);
        if (snapshot.fingerprint !== plans.get(item.database_path)) fail("source_changed_since_preflight");
        const plan = plan_snapshot(snapshot, item, runtime, expected, repairs.get(item.relative_path));
        item.record.backup = await prepare_backup(item, plan, batch_path, runtime, expected);
        item.record.status = "backup_work_verified";
        update_report(batch_report, result);
        if (source_identity(item.database_path) !== item.inode) fail("source_file_replaced");
        const database = new DatabaseSync(item.database_path);
        try {
          database.exec("PRAGMA busy_timeout = 0;");
          import_plan(database, plan, runtime, expected);
          item.record.status = "committed_pending_verification";
        } finally { database.close(); }
        update_report(batch_report, result);
        const check = open_readonly(item.database_path);
        try { check.exec("BEGIN;"); validate_target(check, runtime, expected); }
        finally { check.close(); }
        item.record.status = "migrated";
      } catch (error) {
        const committed = item.record.status === "committed_pending_verification";
        item.record.status = committed ? "committed_verification_failed" : "failed";
        item.record.reason = diagnostic(error);
        for (const remaining of items) if (remaining.record.status === "planned") remaining.record.status = "not_applied_after_failure";
        break;
      } finally {
        update_report(batch_report, result);
        update_report(input.report_path, result);
      }
    }
    result.complete = result.databases.every(record => ["migrated", "validated_v7_skipped"].includes(record.status));
    update_report(batch_report, result);
  } else {
    if (input.apply && blocked) for (const record of result.databases) if (record.status === "planned") record.status = "not_applied_preflight_blocked";
    result.complete = items.length > 0 && !blocked;
  }
  update_report(input.report_path, result);
  return result;
}

const current_file_path = file_url_to_path(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === current_file_path) {
  try {
    const input = parse_arguments(process.argv.slice(2));
    if (input.help) console.log(help_text);
    else {
      const result = await migrate_session_sqlite_v7(input);
      const counts = {};
      for (const record of result.databases) counts[record.status] = (counts[record.status] ?? 0) + 1;
      console.log(JSON.stringify({ mode: result.mode, target_version: 7, complete: result.complete, scanned: result.databases.length, counts, ...(result.reason ? { reason: result.reason } : {}), ...(result.backup_batch ? { backup_batch: result.backup_batch } : {}) }, null, 2));
      if (!result.complete) process.exitCode = 1;
    }
  } catch (error) { console.error(diagnostic(error)); process.exitCode = 1; }
}
