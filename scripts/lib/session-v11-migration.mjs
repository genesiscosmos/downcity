/** v10→v11 历史批次入口：冻结版本策略，复用统一的离线备份与发布引擎。 */
import { create_version_migration } from "./session-version-migration.mjs";
import { content_digest, inspect_database, convert_database } from "./session-v11-conversion.mjs";

export const { preflight, plan_batch, migrate, read_manifest, verify_batch, restore_batch } = create_version_migration({
  source_schema: 10, target_schema: 11, migration_policy: "preserve-message-envelope-v11",
  content_digest, inspect_database, convert_database,
});
