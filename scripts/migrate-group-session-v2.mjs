#!/usr/bin/env node
/**
 * Explicit offline GroupSession metadata v2 preflight/conversion CLI.
 * No runtime root is inferred. Does not open Agent databases, change identities, repair logs,
 * or start services. Every apply/resume requires stopped writers and the reviewed plan hash.
 */
import { parseArgs } from "node:util";
import { resolve_root, preflight, apply_conversion } from "./lib/group-session-v2-migration.mjs";

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    root: { type: "string" }, backup: { type: "string" }, expect: { type: "string" },
    "writers-stopped": { type: "boolean", default: false }, help: { type: "boolean", default: false },
  } });
  if (values.help) {
    console.log(`Offline GroupSession metadata conversion (writers remain stopped throughout).
  node scripts/migrate-group-session-v2.mjs plan --root /absolute/canonical/group-root
  node scripts/migrate-group-session-v2.mjs apply --root /absolute/canonical/group-root --expect <plan_hash> --backup /absolute/new-backup --writers-stopped
  node scripts/migrate-group-session-v2.mjs resume --root /absolute/canonical/group-root --expect <original_plan_hash> --backup /absolute/existing-backup --writers-stopped

plan: read-only inventory and ownership checks; JSON to stdout, no files created.
apply: validate the reviewed hash, backup all source bytes, then atomically replace each v1 meta.
resume: use the original backup; accept only original or planned target bytes throughout the root.
A batch is not globally atomic. A crash lease/staging file requires operator review before resume.
Missing historical group_id/session_id blocks; no ownership override or log repair is provided.
No implicit roots, online migration, Agent database changes, or automatic rollback.`);
  } else {
    const [command, ...extra] = positionals;
    if (extra.length || !["plan", "apply", "resume"].includes(command)) throw new Error("Expected plan, apply or resume");
    if (command === "plan" && (values.backup || values.expect || values["writers-stopped"])) throw new Error("plan accepts only --root");
    const root_path = resolve_root(values.root);
    const result = command === "plan" ? preflight(root_path) : apply_conversion({ root_path,
      backup: values.backup, expect: values.expect, resume: command === "resume", writers_stopped: values["writers-stopped"] });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
