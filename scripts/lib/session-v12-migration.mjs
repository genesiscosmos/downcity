/** v11→v12 离线批次：消息字段映射与通用的备份、发布、验证和恢复机制组合。 */
import { create_version_migration } from "./session-version-migration.mjs";
import { content_digest, inspect_database, convert_database } from "./session-v12-conversion.mjs";

export const { preflight, plan_batch, migrate, read_manifest, verify_batch, restore_batch } = create_version_migration({
  source_schema: 11, target_schema: 12, migration_policy: "session-input-view-v12",
  content_digest, inspect_database, convert_database,
});
