/** 正式版本与过渡版 v12→v13 离线入口；显式停写后才允许发布或恢复。 */
import { parse_arguments } from "./migrate-session-sqlite-v12.mjs";
import { load_runtime } from "./lib/session-runtime.mjs";
import { load_runtime as load_historical } from "./lib/session-v12-runtime.mjs";
import * as migration from "./lib/session-v13-migration.mjs";
import { diagnostic } from "./lib/session-v8-files.mjs";

const help = `Session v12 → v13 offline migration (Node >=22.18; installed workspace dependencies)
支持正式 category/origin v12 和 session-descriptor-v12 过渡格式。
node scripts/migrate-session-sqlite-v13.mjs --preflight|--apply|--verify|--status|--restore
  --root PATH          显式指定数据目录
  --batch PATH         数据目录外的私有批次目录，预检时必须尚未创建
  --writers-stopped    apply 和 restore 必需，调用前退出全部宿主和写进程
  --help               显示帮助`;

try {
  const input = parse_arguments(process.argv.slice(2));
  if (input.help) console.log(help);
  else {
    const runtime = await load_runtime(true);
    const historical = await load_historical();
    const { mode, root_path, batch_path } = input;
    const result = mode === "preflight" ? (batch_path ? migration.plan_batch(root_path, batch_path, runtime, historical) : migration.preflight(root_path, runtime, historical))
      : mode === "apply" ? await migration.migrate(root_path, batch_path, runtime, historical)
        : mode === "verify" ? migration.verify_batch(root_path, batch_path, runtime, historical)
          : mode === "restore" ? migration.restore_batch(root_path, batch_path, runtime, historical)
            : migration.read_manifest(root_path, batch_path);
    const totals = Object.fromEntries(["sessions", "messages", "message_parts", "archive_operations"].map(key => [key,
      result.agents.reduce((total, agent) => total + (agent.proof?.[key] ?? 0), 0)]));
    console.log(JSON.stringify({ status: result.status, batch_path, databases: result.agents.length, ...totals, blockers: result.blockers }));
    if (result.status === "blocked") process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ status: "failed", reason: diagnostic(error) }));
  process.exitCode = 1;
}
