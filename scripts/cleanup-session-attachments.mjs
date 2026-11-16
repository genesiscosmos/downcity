/** 显式离线附件清理入口：固定root/Agent、有界日志、根与附件双重独占，不启动宿主。 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL as path_to_file_url } from "node:url";
import { RootLease, assert_session_storage_ready } from "../packages/city/bin/local/index.js";
import { cleanup_agent_session_attachments } from "../packages/agent/bin/index.js";

const help_text = `Offline Agent attachment maintenance (build Agent and City first)
node scripts/cleanup-session-attachments.mjs --root PATH --agent ID --writers-stopped [--limit 20] [--max-entries 10000]
  --prepare-only     Prepare missing read/maintenance coordination; consumes no deletion logs.
Only committed deletion log UUIDs are visited. No startup sweep or unlogged-directory scan.
Quit all writers/readers/exporters before maintenance. Failures keep their logs for explicit retry.`;

/** 不提供默认根/全部Agent选择，参数拼写错误不能扩大删除范围。 */
export function parse_arguments(arguments_) {
  const input = {}; const seen = new Set();
  const fields = { "--root": "root_path", "--agent": "agent_id", "--limit": "limit", "--max-entries": "max_entries" };
  for (let index = 0; index < arguments_.length; index++) {
    const option = arguments_[index];
    if (seen.has(option)) throw new Error("session_cleanup_duplicate_argument"); seen.add(option);
    if (option === "--help") input.help = true;
    else if (option === "--writers-stopped") input.writers_stopped = true;
    else if (option === "--prepare-only") input.prepare_only = true;
    else if (fields[option]) {
      const value = arguments_[++index];
      if (!value || value.startsWith("--")) throw new Error("session_cleanup_missing_argument");
      input[fields[option]] = ["--limit", "--max-entries"].includes(option) ? Number(value) : value;
    } else throw new Error("session_cleanup_unknown_argument");
  }
  if (!input.help) validate(input);
  return input;
}

/** 导出run同样校验显式离线声明，不让绕过parser的调用扩大授权。 */
function validate(input) {
  if (!input.root_path || !input.agent_id || !input.writers_stopped) throw new Error("session_cleanup_explicit_root_agent_and_stopped_required");
  if (input.agent_id.trim() !== input.agent_id || /[\\/\0]/u.test(input.agent_id) || [".", ".."].includes(input.agent_id)) throw new Error("session_cleanup_agent_invalid");
}

export async function run(input) {
  if (input.help) { console.log(help_text); return 0; }
  validate(input);
  const root_path = fs.realpathSync(input.root_path);
  const lease = RootLease.acquire_write(root_path);
  try {
    await assert_session_storage_ready(root_path);
    const result = cleanup_agent_session_attachments({ agent_id: input.agent_id, storage_root_path: path.join(root_path, "agents", input.agent_id),
      limit: input.limit, max_entries: input.max_entries, prepare_only: input.prepare_only });
    console.log(JSON.stringify(result));
    return result.failed.length ? 1 : 0;
  } finally { lease.release(); }
}

if (process.argv[1] && import.meta.url === path_to_file_url(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(parse_arguments(process.argv.slice(2))); }
  catch (error) {
    const code = error?.message?.match(/^session_[a-z_]+$/u)?.[0] ?? "session_attachment_maintenance_failed";
    console.error(JSON.stringify({ status: "failed", code })); process.exitCode = 1;
  }
}
