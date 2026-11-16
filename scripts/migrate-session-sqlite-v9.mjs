/**
 * Agent Session v8 → v9 全根离线转换入口。默认只读预检，正式执行必须声明写入进程已退出。
 * 结果只显示数量与固定诊断码；私有报告保存精确身份映射，绝不打印消息或凭据。
 */
import path from "node:path";
import os from "node:os";
import { pathToFileURL as path_to_file_url } from "node:url";
import { fail } from "./lib/session-v7-database.mjs";
import { load_runtime } from "./lib/session-v9-runtime.mjs";
import { diagnostic, exists, save_json } from "./lib/session-v8-files.mjs";
import { preflight, migrate, read_manifest, verify_batch, restore_batch } from "./lib/session-v9-migration.mjs";

const help_text = `Session v8 → v9 offline migration (Node >=22.18; installed source workspace)
node scripts/migrate-session-sqlite-v9.mjs [--preflight|--apply|--status|--verify|--restore]
  --root PATH          Data root; default ~/.downcity. Includes all Agent databases.
  --batch PATH         Private batch outside data root. Reuse the same batch after interruption.
  --writers-stopped    Required for apply/restore; quit every Desktop/CLI/Agent writer first.
  --recover-reviewed  Apply the explicitly reviewed interruption/disable/audit policy in staging.
  --report PATH        New private JSON report outside data root; never overwrites a report.
  --help               Show help without opening any storage.
Default preflight does not change source data. Any blocker prevents the whole batch.
Each v8 storage_id becomes session_id unchanged (preserve-record-uuid-v1).
Batches with missing/different identity policies require review. Backups and mappings remain private.
No models, process stop/start, automatic migration or backup cleanup.`;

/** 封闭参数和互斥模式，拼写错误不能扩大数据修改范围。 */
export function parse_arguments(arguments_) {
  const input = { mode: "preflight", root_path: path.join(os.homedir(), ".downcity") };
  const seen = new Set(); let mode_seen = false;
  const fields = { "--root": "root_path", "--batch": "batch_path", "--report": "report_path" };
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (seen.has(argument)) fail("duplicate_argument"); seen.add(argument);
    if (["--preflight", "--apply", "--status", "--verify", "--restore"].includes(argument)) {
      if (mode_seen) fail("conflicting_modes"); mode_seen = true; input.mode = argument.slice(2);
    } else if (fields[argument]) {
      const value = arguments_[++index]; if (!value || value.startsWith("--")) fail("missing_argument_value");
      input[fields[argument]] = path.resolve(value);
    } else if (argument === "--writers-stopped") input.writers_stopped = true;
    else if (argument === "--recover-reviewed") input.recover_reviewed = true;
    else if (argument === "--help") input.help = true;
    else fail("unknown_argument");
  }
  if (!input.help && input.mode !== "preflight" && !input.batch_path) fail("batch_required");
  if (!input.help && ["apply", "restore"].includes(input.mode) && !input.writers_stopped) fail("writers_stopped_confirmation_required");
  return input;
}

/** 报告必须在根外且不存在；只写审阅所需结构，不包含 canonical 正文。 */
export async function run(input) {
  if (input.help) { console.log(help_text); return 0; }
  const runtime = await load_runtime(true);
  if (input.report_path) {
    const root = runtime.resolve_resource_root(input.root_path); const report = runtime.resolve_resource_root(input.report_path);
    if (report === root || report.startsWith(`${root}${path.sep}`)) fail("report_must_be_outside_data_root");
    if (exists(report)) fail("output_already_exists");
  }
  if (["apply", "restore"].includes(input.mode) && !input.writers_stopped) fail("writers_stopped_confirmation_required");
  const options = { recover_reviewed: input.recover_reviewed === true };
  const result = input.mode === "preflight" ? await preflight(input.root_path, runtime, options)
    : input.mode === "apply" ? await migrate(input.root_path, input.batch_path, runtime, options)
      : input.mode === "verify" ? verify_batch(input.root_path, input.batch_path, runtime)
        : input.mode === "restore" ? restore_batch(input.root_path, input.batch_path, runtime)
          : read_manifest(input.root_path, input.batch_path);
  if (input.report_path) save_json(input.report_path, result);
  const blocker_counts = {};
  for (const blocker of result.blockers) blocker_counts[blocker.reason] = (blocker_counts[blocker.reason] ?? 0) + 1;
  console.log(JSON.stringify({ status: result.status, agents: result.agents.length,
    sessions: result.agents.reduce((total, agent) => total + (agent.identities?.length ?? 0), 0),
    artifacts: result.artifacts.length, recoveries: result.recovery?.entries.length ?? 0, blockers: blocker_counts }));
  return ["planned", "ready", "verified", "restored"].includes(result.status) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === path_to_file_url(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(parse_arguments(process.argv.slice(2))); }
  catch (error) { console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) })); process.exitCode = 1; }
}
