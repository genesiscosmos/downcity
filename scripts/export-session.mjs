/**
 * 单 Session 离线导出与目录包校验。要求显式数据根和记录 UUID，不启动执行器。
 * export 只读业务库，写新包；verify 只读包，不访问包中记录的原数据根或附件路径。
 */
import path from "node:path";
import { pathToFileURL as path_to_file_url } from "node:url";
import { load_runtime } from "./lib/session-runtime.mjs";
import { fail } from "./lib/session-v7-database.mjs";
import { diagnostic } from "./lib/session-v8-files.mjs";
import { export_session, load_package } from "./lib/session-transfer-package.mjs";
import { uuid_pattern } from "./lib/session-transfer-record.mjs";

const help_text = `Single Session export (Node >= 22.18, checkout dependencies required)
node scripts/export-session.mjs --export --root PATH --agent ID --session-id UUID --package PATH --operation-id UUID --writers-stopped
node scripts/export-session.mjs --verify-package --package PATH
Exports schema v10 to format 3; --allow-unresolved-sources explicitly preserves unavailable sources.
Export creates a private versioned directory outside the data root; it never overwrites a different package.
Resume an interrupted export with the SAME arguments and operation UUID. Source changes block resume.
Quit writers before export. Verification reads the package only, not its original source paths.
This tool does not import records, stop/start services, or remove source/backup files.`;

/** 封闭参数；没有默认根，没有基于逻辑 ID 的自动猜选，也不隐式选择操作模式。 */
export function parse_arguments(arguments_) {
  const input = {}; const seen = new Set();
  const fields = { "--root": "root_path", "--agent": "agent_id", "--session-id": "session_id",
    "--package": "package_path", "--operation-id": "operation_id" };
  for (let index = 0; index < arguments_.length; index++) {
    const option = arguments_[index];
    if (seen.has(option)) fail("duplicate_argument"); seen.add(option);
    if (["--export", "--verify-package"].includes(option)) {
      if (input.mode) fail("conflicting_modes"); input.mode = option === "--export" ? "export" : "verify";
    } else if (option === "--help") input.help = true;
    else if (option === "--writers-stopped") input.writers_stopped = true;
    else if (option === "--allow-unresolved-sources") input.allow_unresolved_sources = true;
    else if (fields[option]) {
      const value = arguments_[++index];
      if (!value || value.startsWith("--")) fail("missing_argument_value");
      input[fields[option]] = ["--root", "--package"].includes(option) ? path.resolve(value) : value;
    } else fail("unknown_argument");
  }
  if (!input.help) validate(input);
  return input;
}

/** run 与 parser 共用参数门禁，直接调用同样不能跳过显式离线声明。 */
function validate(input) {
  if (!["export", "verify"].includes(input.mode) || !input.package_path) fail("transfer_mode_and_package_required");
  if (input.mode === "verify") {
    if (input.root_path || input.agent_id || input.session_id || input.operation_id || input.writers_stopped || input.allow_unresolved_sources) fail("transfer_verify_unexpected_selector");
    return;
  }
  if (!input.root_path || !input.agent_id || !input.writers_stopped) fail("transfer_explicit_root_agent_and_stopped_required");
  if (input.agent_id.trim() !== input.agent_id || /[\\/\0]/u.test(input.agent_id) || [".", ".."].includes(input.agent_id)) fail("transfer_agent_invalid");
  if (!uuid_pattern.test(input.session_id ?? "") || !uuid_pattern.test(input.operation_id ?? "")) fail("transfer_operation_identity_invalid");
}

/** 输出仅包含结构与结果，不回显正文、数据库错误或附件路径。 */
export async function run(input) {
  if (input.help) { console.log(help_text); return 0; }
  validate(input);
  const runtime = await load_runtime(true);
  if (input.mode === "export") {
    const result = await export_session(input, runtime);
    console.log(JSON.stringify({ status: result.status, session_id: result.session_id, unresolved_sources: result.unresolved_sources }));
  } else {
    const { manifest, record } = load_package(path.resolve(input.package_path), runtime);
    console.log(JSON.stringify({ status: "verified", agent_id: manifest.agent_id, session_id: manifest.session_id,
      messages: record.messages.length, parts: record.message_parts.length, attachments: manifest.attachments.length,
      external_sources: manifest.sources.length }));
  }
  return 0;
}

if (process.argv[1] && import.meta.url === path_to_file_url(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(parse_arguments(process.argv.slice(2))); }
  catch (error) { console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) })); process.exitCode = 1; }
}
