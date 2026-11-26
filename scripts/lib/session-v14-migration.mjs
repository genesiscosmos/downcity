/** v13→v14 离线批次；复用停写租约、完整备份、暂存验收与恢复流程。 */
import { create_version_migration } from "./session-version-migration.mjs";
import { content_digest, inspect_database, convert_database } from "./session-agent-variables-conversion.mjs";

export const { preflight, plan_batch, migrate, read_manifest, verify_batch, restore_batch } = create_version_migration({
  source_schema: 13, target_schema: 14, migration_policy: "agent-variables-v14",
  content_digest, inspect_database, convert_database,
});
