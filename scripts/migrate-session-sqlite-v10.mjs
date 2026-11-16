/**
 * 显式 v9→v10 离线维护。预检只读源根，批次保存可审阅证据与策略。
 * 恢复模式必须在预检及 apply 显式选择；apply/restore 要求停写声明，工具不管理进程。
 */
import path from "node:path";
import { pathToFileURL as path_to_file_url } from "node:url";
import { load_runtime } from "./lib/session-runtime.mjs";
import { load_runtime as load_historical } from "./lib/session-v9-runtime.mjs";
import { preflight, plan_batch, migrate, read_manifest, verify_batch, restore_batch } from "./lib/session-v10-migration.mjs";
import { fail } from "./lib/session-v7-database.mjs";
import { diagnostic } from "./lib/session-v8-files.mjs";

const help_text = `Session v9 → v10 evidence-preserving offline migration (Node >=22.18)
node scripts/migrate-session-sqlite-v10.mjs [--preflight|--apply|--status|--verify|--restore]
  --root PATH          Required explicit stopped data root; never defaults to a user root.
  --batch PATH         New private external plan for preflight; same batch for later actions.
  --writers-stopped    Required for apply/restore. Quit every writer yourself first.
  --recover-reviewed   Preflight/apply only. Rebuild missing/oversized historical Tool snapshots.
  --help               Show help without opening data.
Preflight without --batch prints the private evidence report; --batch saves manifest.json.
Review all Tool evidence, stable watermarks and checkpoint impact before apply.
Default: missing/unknown/conflicting first-disclosure evidence blocks apply; proven snapshots stay unchanged.
Recovery: review every generated snapshot hash and invalidated checkpoint before apply.
Rebuilt views describe migration-time output, not proven first disclosure. Raw results remain unchanged.
Unknown versions and conflicting references still block. Recovery must match the saved batch policy.
Interrupted apply/restore resumes only the same owned batch. No automatic backup cleanup.`;

/** Closed arguments prevent a typo from selecting another root, mode or policy. */
export function parse_arguments(arguments_) {
  const input = { mode: "preflight" }; const seen = new Set(); let mode_seen = false;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (seen.has(argument)) fail("duplicate_argument"); seen.add(argument);
    if (["--preflight", "--apply", "--status", "--verify", "--restore"].includes(argument)) {
      if (mode_seen) fail("conflicting_modes"); mode_seen = true; input.mode = argument.slice(2);
    } else if (["--root", "--batch"].includes(argument)) {
      const value = arguments_[++index]; if (!value || value.startsWith("--")) fail("missing_argument_value");
      input[argument === "--root" ? "root_path" : "batch_path"] = path.resolve(value);
    } else if (argument === "--writers-stopped") input.writers_stopped = true;
    else if (argument === "--recover-reviewed") input.recover_reviewed = true;
    else if (argument === "--help") input.help = true;
    else fail("unknown_argument");
  }
  if (!input.help && (!input.root_path || (input.mode !== "preflight" && !input.batch_path))) fail("explicit_root_and_batch_required");
  if (!input.help && ["apply", "restore"].includes(input.mode) && !input.writers_stopped) fail("writers_stopped_confirmation_required");
  if (!input.help && input.recover_reviewed && !["preflight", "apply"].includes(input.mode)) fail("recovery_only_for_preflight_or_apply");
  return input;
}

/** Load explicit current/historical bridges and print only reviewed structural evidence. */
export async function run(input) {
  if (input.help) { console.log(help_text); return 0; }
  if (!input.root_path || (input.mode !== "preflight" && !input.batch_path)) fail("explicit_root_and_batch_required");
  if (["apply", "restore"].includes(input.mode) && !input.writers_stopped) fail("writers_stopped_confirmation_required");
  if (input.recover_reviewed && !["preflight", "apply"].includes(input.mode)) fail("recovery_only_for_preflight_or_apply");
  const runtime = await load_runtime(true); const historical = await load_historical();
  const result = input.mode === "preflight"
    ? (input.batch_path ? plan_batch(input.root_path, input.batch_path, runtime, historical, input.recover_reviewed) : preflight(input.root_path, runtime, historical, input.recover_reviewed))
    : input.mode === "apply" ? await migrate(input.root_path, input.batch_path, runtime, historical, input.recover_reviewed)
      : input.mode === "verify" ? verify_batch(input.root_path, input.batch_path, runtime, historical)
        : input.mode === "restore" ? restore_batch(input.root_path, input.batch_path, runtime, historical)
          : read_manifest(input.root_path, input.batch_path);
  console.log(JSON.stringify(result)); return result.status === "blocked" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === path_to_file_url(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(parse_arguments(process.argv.slice(2))); }
  catch (error) { console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) })); process.exitCode = 1; }
}
