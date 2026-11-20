/** 正式 v12→v13 批次；复用完整备份、根租约、暂存验收、原子发布与失败恢复。 */
import { create_version_migration } from "./session-version-migration.mjs";
import { content_digest, inspect_database, convert_database } from "./session-descriptor-conversion.mjs";

export const { preflight, plan_batch, migrate, read_manifest, verify_batch, restore_batch } = create_version_migration({
  source_schema: 12, target_schema: 13, migration_policy: "session-flat-v13",
  content_digest, inspect_database, convert_database,
});
