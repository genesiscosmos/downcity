/** SessionDescriptor 离线迁移入口，复用整根批次的备份、发布、验证与恢复。 */
import { parse_arguments } from "./migrate-session-sqlite-v12.mjs";
import { create_version_migration } from "./lib/session-version-migration.mjs";
import { content_digest, inspect_database, convert_database } from "./lib/session-descriptor-conversion.mjs";
import { diagnostic } from "./lib/session-v8-files.mjs";

const help = `SessionDescriptor 离线迁移（先构建 Agent、Type 和 City）
node scripts/migrate-session-descriptor.mjs --preflight|--apply|--verify|--status|--restore
  --root PATH          显式指定数据目录
  --batch PATH         数据目录外的私有批次目录，预检时必须尚未创建
  --writers-stopped    apply 和 restore 必需，调用前退出全部宿主和写进程
  --help               显示帮助`;

try {
  const input = parse_arguments(process.argv.slice(2));
  if (input.help) console.log(help);
  else {
    const modules = await Promise.all([
      import("../packages/agent/bin/session/storage/agent-db/AgentSessionSchema.js"),
      import("../packages/agent/bin/session/storage/agent-db/AgentSessionFileLease.js"),
      import("../packages/agent/bin/session/storage/SessionStorageCodec.js"),
      import("../packages/type/bin/types/session/SessionDescriptor.js"),
      import("../packages/city/bin/local/resources/RootLease.js"),
    ]);
    const runtime = Object.assign({}, ...modules);
    // 源格式由转换器固定的 DDL 摘要识别，预检用目标 codec 验证转换后的消息。
    const historical = { ...runtime, AGENT_SESSION_SCHEMA_VERSION: 12 };
    const migration = create_version_migration({ source_schema: 12, target_schema: 12,
      migration_policy: "session-descriptor-v12", content_digest, inspect_database, convert_database });
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
