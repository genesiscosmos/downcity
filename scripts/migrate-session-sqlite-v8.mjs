/**
 * Session v8 离线合库入口。默认全根只读预检，不启动宿主、模型或任务。
 * apply/restore 必须显式声明已退出全部写入进程，并取得现有 RootLease 独占租约。
 * 每批次支持 status、完整 verify、崩溃后同批次继续、业务写入前 restore。
 */
import path from "node:path";
import os from "node:os";
import { pathToFileURL as path_to_file_url } from "node:url";
import { load_runtime } from "./lib/session-v7-runtime.mjs";
import { load_repair_manifest } from "./lib/session-v7-repairs.mjs";
import { fail } from "./lib/session-v7-database.mjs";
import { exists, save_json, diagnostic, load_recovered_sources } from "./lib/session-v8-files.mjs";
import { preflight, migrate, read_manifest, verify_batch, restore_batch } from "./lib/session-v8-migration.mjs";

const help_text = `Session v8 offline migration (Node >= 22.18, source checkout dependencies required)
node scripts/migrate-session-sqlite-v8.mjs [--preflight | --apply | --status | --verify | --restore]
  --root PATH              Data root; default ~/.downcity. Always includes ALL Agent partitions.
  --batch PATH             New private batch outside the data root; reuse to resume apply.
  --writers-stopped        Required for apply/restore; quit ALL Desktop/CLI/Agent writers first.
  --repair-manifest PATH   Exact reviewed v5/v6 repairs; unsupported/stale/unused entries block.
  --recovered-sources PATH Exact reviewed preserved archives to include; never changes old root.
  --report PATH            New private JSON report; never overwrites an existing file.
  --help                   Show help without opening storage.
Default is read-only preflight. Any blocker prevents apply. Sources remain unchanged.
No model requests, process stop/start, automatic restore, or backup cleanup.`;

/** 封闭参数防止拼写错误扩大写入范围，help 不加载运行时或数据根。 */
export function parse_arguments(arguments_) {
  const input = { mode: "preflight", root_path: path.join(os.homedir(), ".downcity") };
  const modes = ["--preflight", "--apply", "--status", "--verify", "--restore"];
  const fields = { "--root": "root_path", "--batch": "batch_path", "--report": "report_path", "--repair-manifest": "repair_manifest_path", "--recovered-sources": "recovered_sources_path" };
  const seen = new Set(); let mode_seen = false;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (seen.has(argument)) fail("duplicate_argument"); seen.add(argument);
    if (modes.includes(argument)) { if (mode_seen) fail("conflicting_modes"); mode_seen = true; input.mode = argument.slice(2); }
    else if (argument === "--writers-stopped") input.writers_stopped = true;
    else if (argument === "--help") input.help = true;
    else if (fields[argument]) {
      const value = arguments_[++index]; if (!value || value.startsWith("--")) fail("missing_argument_value"); input[fields[argument]] = path.resolve(value);
    } else fail("unknown_argument");
  }
  if (!input.help && input.mode !== "preflight" && !input.batch_path) fail("batch_required");
  if (!input.help && ["apply", "restore"].includes(input.mode) && !input.writers_stopped) fail("writers_stopped_confirmation_required");
  if (input.repair_manifest_path && !["preflight", "apply"].includes(input.mode)) fail("repairs_not_supported_for_mode");
  if (input.recovered_sources_path && !["preflight", "apply"].includes(input.mode)) fail("recovered_sources_not_supported_for_mode");
  return input;
}

/** 执行结果只含结构信息；失败原始诊断不能泄漏正文和凭据。 */
export async function run(input) {
  if (input.help) { console.log(help_text); return 0; }
  if (input.report_path && exists(input.report_path)) fail("output_already_exists");
  const runtime = await load_runtime(true);
  if (input.report_path) {
    const report_path = runtime.resolve_resource_root(input.report_path);
    const root_path = runtime.resolve_resource_root(input.root_path);
    if (report_path === root_path || report_path.startsWith(`${root_path}${path.sep}`)) fail("report_must_be_outside_data_root");
  }
  const repairs = load_repair_manifest(input.repair_manifest_path);
  const recovered_sources = load_recovered_sources(input.recovered_sources_path);
  const result = input.mode === "preflight" ? preflight(input.root_path, runtime, repairs, recovered_sources)
    : input.mode === "apply" ? await migrate(input.root_path, input.batch_path, runtime, repairs, recovered_sources)
      : input.mode === "verify" ? verify_batch(input.root_path, input.batch_path, runtime)
        : input.mode === "restore" ? restore_batch(input.root_path, input.batch_path, runtime)
          : read_manifest(input.batch_path, input.root_path);
  if (input.report_path) save_json(input.report_path, result);
  console.log(JSON.stringify({ status: result.status, ...(result.reason ? { reason: result.reason } : {}), agents: Array.isArray(result.agents) ? result.agents.length : result.agents,
    ...(Array.isArray(result.agents) ? { blocked_agents: result.agents.filter(agent => agent.status === "blocked").map(agent => ({ agent_id: agent.agent_id, reason: agent.reason })) } : {}) }));
  return ["planned", "ready", "verified", "restored"].includes(result.status) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === path_to_file_url(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(parse_arguments(process.argv.slice(2))); }
  catch (error) { console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) })); process.exitCode = 1; }
}
