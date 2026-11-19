/**
 * 显式 v10→v11 整根离线迁移入口。默认只读预检，没有默认用户数据根。
 * apply/restore 要求宿主已退出；工具负责租约、完整备份、可恢复发布与验收，不管理进程。
 */
import path from "node:path";
import { pathToFileURL as path_to_file_url } from "node:url";
import { load_runtime } from "./lib/session-v11-runtime.mjs";
import { load_runtime as load_historical } from "./lib/session-v10-runtime.mjs";
import { preflight, plan_batch, migrate, read_manifest, verify_batch, restore_batch } from "./lib/session-v11-migration.mjs";
import { fail } from "./lib/session-v7-database.mjs";
import { diagnostic } from "./lib/session-v8-files.mjs";

const help_text = `Session v10 → v11 lossless offline migration (Node >=22.18)
node scripts/migrate-session-sqlite-v11.mjs [--preflight|--apply|--status|--verify|--restore]
  --root PATH          Required explicit data root; never defaults to a user root.
  --batch PATH         New private external plan for preflight; reuse it for later actions.
  --writers-stopped    Required for apply/restore. Quit every writer first.
  --help               Show help without opening data.
Preflight only reads source data and reports schema, row counts and content hashes.
Apply backs up ALL databases before conversion and publication. Messages, Parts, stable
watermarks, identities, receipts, checkpoints and attachments remain unchanged.
Interrupted apply/restore resumes the same batch. Restore refuses later business writes.
No automatic process management or backup cleanup.`;

/** 封闭参数集，防止拼写错误选择另一种操作或默认数据根。 */
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
    else if (argument === "--help") input.help = true;
    else fail("unknown_argument");
  }
  validate_input(input); return input;
}

/** 程序调用与 CLI 共用约束；只读检查不要求停写声明，发布始终要求。 */
function validate_input(input) {
  if (input.help) return;
  if (!["preflight", "apply", "status", "verify", "restore"].includes(input.mode)) fail("unknown_mode");
  if (!input.root_path || (input.mode !== "preflight" && !input.batch_path)) fail("explicit_root_and_batch_required");
  if (["apply", "restore"].includes(input.mode) && !input.writers_stopped) fail("writers_stopped_confirmation_required");
}

/** 输出仅含结构证据；原始 SQLite/文件错误不向终端泄露消息正文。 */
export async function run(input) {
  validate_input(input);
  if (input.help) { console.log(help_text); return 0; }
  const runtime = await load_runtime(true); const historical = await load_historical();
  const result = input.mode === "preflight"
    ? (input.batch_path ? plan_batch(input.root_path, input.batch_path, runtime, historical) : preflight(input.root_path, runtime, historical))
    : input.mode === "apply" ? await migrate(input.root_path, input.batch_path, runtime, historical)
      : input.mode === "verify" ? verify_batch(input.root_path, input.batch_path, runtime, historical)
        : input.mode === "restore" ? restore_batch(input.root_path, input.batch_path, runtime, historical)
          : read_manifest(input.root_path, input.batch_path);
  console.log(JSON.stringify(result)); return result.status === "blocked" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === path_to_file_url(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(parse_arguments(process.argv.slice(2))); }
  catch (error) { console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) })); process.exitCode = 1; }
}
