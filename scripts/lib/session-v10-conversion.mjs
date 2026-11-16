/**
 * 已核验备份的隔离 v9→v10 转换。默认仅改格式元数据；恢复模式按已审阅摘要修改
 * Tool 派生快照及覆盖它的检查点。原始结果、身份、水位、receipt 和附件均不变。
 * 稳定内容触发器只在私有 stage 事务内暂时移除，发布前恢复完整正式 DDL。
 */
import fs from "node:fs";
import { backup, DatabaseSync } from "node:sqlite";
import { open_source, database_fingerprint } from "./session-v9-database.mjs";
import { inspect_database, validate_target } from "./session-v10-proof.mjs";
import { digest, fail } from "./session-v7-database.mjs";
import { read_record } from "./session-transfer-record.mjs";
import { terminal_policy, recovery_policy, prepare_record } from "./session-v10-recovery.mjs";

/** 仅更新 stage 的快照字段；按精确检查点主键删除受影响摘要，不降低稳定水位。 */
function rebuild_snapshots(database, runtime) {
  const trigger = database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='message_parts_stable_prefix_update'").get();
  if (!trigger) fail("session_protocol_schema_mismatch");
  database.exec("DROP TRIGGER message_parts_stable_prefix_update");
  const update = database.prepare("UPDATE message_parts SET content=? WHERE session_key=? AND part_id=?");
  const clear = database.prepare("DELETE FROM composer_checkpoints WHERE session_key=? AND namespace=? AND checkpoint_id=?");
  for (const session of database.prepare("SELECT session_key,session_id FROM sessions ORDER BY session_key").iterate()) {
    const prepared = prepare_record(read_record(database, session.session_id), runtime, recovery_policy);
    if (prepared.blockers.length) fail(prepared.blockers[0].reason);
    for (const row of prepared.record.message_parts) if (prepared.repairs.has(row.part_id)) update.run(row.content, session.session_key, row.part_id);
    for (const checkpoint of prepared.cleared_checkpoints) clear.run(session.session_key, checkpoint.namespace, checkpoint.checkpoint_id);
  }
  database.exec(trigger.sql);
}

/** 从一致性备份转换；重建结果须匹配原预检摘要，事务提交前接受完整 v10 校验。 */
export async function convert_database(source_path, target_path, agent_id, historical, runtime, options = {}) {
  if (historical.AGENT_SESSION_SCHEMA_VERSION !== 9 || runtime.AGENT_SESSION_SCHEMA_VERSION !== 10) fail("v10_conversion_runtime_mismatch");
  const source = open_source(source_path);
  try {
    const policy = options.terminal_policy ?? terminal_policy;
    const proof = inspect_database(source, agent_id, historical, runtime, policy);
    if (proof.blockers.length) fail("v10_first_disclosure_unproven");
    if (options.proof_sha256 && digest(proof) !== options.proof_sha256) fail("recovery_plan_changed_since_preflight");
    const source_fingerprint = database_fingerprint(source);
    await backup(source, target_path); fs.chmodSync(target_path, 0o600);
    const target = new DatabaseSync(target_path);
    const expected = new DatabaseSync(":memory:");
    try {
      expected.exec(runtime.AGENT_SESSION_SCHEMA_SQL);
      const metadata_sql = expected.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='storage_metadata'").get().sql;
      const metadata = target.prepare("SELECT * FROM storage_metadata").get();
      target.exec("PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE;");
      target.exec("DROP TABLE storage_metadata;"); target.exec(metadata_sql);
      const names = Object.keys(metadata);
      target.prepare(`INSERT INTO storage_metadata (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`)
        .run(...names.map(name => name === "format_version" ? 10 : metadata[name]));
      if (policy === recovery_policy) rebuild_snapshots(target, runtime);
      target.exec("PRAGMA user_version=10;");
      validate_target(target, agent_id, runtime);
      target.exec("COMMIT;");
      if (database_fingerprint(source) !== source_fingerprint) fail("source_changed_during_conversion");
      return proof;
    } finally { target.close(); expected.close(); }
  } finally { source.close(); }
}
