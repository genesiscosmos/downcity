/** 单 Session 目录包的显式离线导入；同 Agent 原身份、冲突拒绝，不启停宿主或创建目标库。 */
import path from "node:path";
import { pathToFileURL as path_to_file_url } from "node:url";
import { load_runtime } from "./lib/session-v7-runtime.mjs";
import { fail } from "./lib/session-v7-database.mjs";
import { diagnostic } from "./lib/session-v8-files.mjs";
import { uuid_pattern } from "./lib/session-transfer-record.mjs";
import { import_session } from "./lib/session-transfer-import.mjs";

const help_text = `Single Session import (Node >= 22.18, checkout dependencies required)
node scripts/import-session.mjs --root PATH --agent ID --package PATH --batch PATH --operation-id UUID --writers-stopped
  --allow-unresolved-sources  Preserve exact unavailable source references; never rebind by logical ID.
The target must be an existing ready v8 database belonging to the SAME Agent.
Preserves storage UUID and active/archive status. Conflicts never overwrite records or files.
Batch must be outside the data root and package. Resume with the SAME arguments and operation UUID.
No automatic import retry, source removal, root migration, or service stop/start.`;

/** 无默认根、隐式覆盖和自动改身份模式；重入必须由用户保留原参数。 */
export function parse_arguments(arguments_) {
  const input = {}; const seen = new Set();
  const fields = { "--root": "root_path", "--agent": "agent_id", "--package": "package_path",
    "--batch": "batch_path", "--operation-id": "operation_id" };
  for (let index = 0; index < arguments_.length; index++) {
    const option = arguments_[index];
    if (seen.has(option)) fail("duplicate_argument"); seen.add(option);
    if (option === "--help") input.help = true;
    else if (option === "--writers-stopped") input.writers_stopped = true;
    else if (option === "--allow-unresolved-sources") input.allow_unresolved_sources = true;
    else if (fields[option]) {
      const value = arguments_[++index]; if (!value || value.startsWith("--")) fail("missing_argument_value");
      input[fields[option]] = ["--root", "--package", "--batch"].includes(option) ? path.resolve(value) : value;
    } else fail("unknown_argument");
  }
  if (!input.help) validate(input);
  return input;
}

/** 程序化run也要求完整参数，拒绝隐式触碰默认用户数据根。 */
function validate(input) {
  if (!input.root_path || !input.agent_id || !input.package_path || !input.batch_path || !input.writers_stopped
    || !uuid_pattern.test(input.operation_id ?? "")) fail("transfer_import_explicit_parameters_required");
  if (input.agent_id.trim() !== input.agent_id || /[\\/\0]/u.test(input.agent_id) || [".", ".."].includes(input.agent_id)) fail("transfer_agent_invalid");
}

/** 返回结构结果，不打印包内正文、目标路径或原始数据库异常。 */
export async function run(input) {
  if (input.help) { console.log(help_text); return 0; }
  validate(input);
  const result = await import_session(input, await load_runtime(true));
  console.log(JSON.stringify({ status: result.status, storage_id: result.storage_id,
    unresolved_sources: result.unresolved_sources, replayed: result.replayed }));
  return 0;
}

if (process.argv[1] && import.meta.url === path_to_file_url(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(parse_arguments(process.argv.slice(2))); }
  catch (error) { console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) })); process.exitCode = 1; }
}
