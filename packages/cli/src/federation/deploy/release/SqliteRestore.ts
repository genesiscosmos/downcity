/**
 * 已停止服务的 SQLite 原子恢复。
 * 恢复先保全当前数据库，显式确认后再次核对服务、输入和源文件，再替换主库。
 * 不自动启停服务、不修改 release 或秘密配置，WAL 只通过 SQLite checkpoint 收敛。
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmod, lstat, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assert_release_service_stopped } from "./LocalReleaseProcess.js";
import { assert_no_sqlite_sidecars, assert_sqlite_integrity, create_sqlite_snapshot, require_sqlite_file, snapshot_digest, sync_snapshot_path, verify_sqlite_snapshot } from "./SqliteSnapshots.js";
import type { ServerProfile } from "../../core/session.js";
import type { SqliteBackupSource, SqliteRestoreInteraction, SqliteRestorePreview, SqliteRestoreResult } from "../../types/SqliteBackup.js";

/** 捕获主库和 sidecar 的内容摘要，确认期间有外部写入则拒绝覆盖。 */
async function database_fingerprint(database_path: string): Promise<string> {
  const facts: unknown[] = [];
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const file_path = `${database_path}${suffix}`;
    try {
      const stat = await lstat(file_path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe database sidecar");
      facts.push([suffix, stat.dev, stat.ino, stat.size, stat.mtimeMs, await snapshot_digest(file_path)]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !suffix) throw error;
      facts.push([suffix, "absent"]);
    }
  }
  return JSON.stringify(facts);
}

/** 调用者必须持有同 Fed 部署锁；dry-run 不创建安全备份、不 checkpoint、不改权限。 */
export async function restore_sqlite_snapshot(server: ServerProfile, source: SqliteBackupSource,
  backup_path: string, interaction: SqliteRestoreInteraction, dry_run = false): Promise<SqliteRestoreResult> {
  await assert_release_service_stopped(server);
  const target = await require_sqlite_file(source.database_path);
  let backup = await verify_sqlite_snapshot(backup_path, source.fed_id);
  const source_stat = await lstat(target);
  const backup_stat = await lstat(backup.database_path);
  if (target === backup.database_path || (source_stat.dev === backup_stat.dev && source_stat.ino === backup_stat.ino)) {
    throw new Error("Restore backup must be separate from the deployed database");
  }
  // dry-run 不打开当前 WAL 数据库，以免 SQLite 的只读连接仍创建 SHM/WAL sidecar。
  if (dry_run) return { backup, database_path: target, restored: false };
  const before_safety = await database_fingerprint(target);
  const safety_backup = await create_sqlite_snapshot(source, "before_restore");
  const before_confirmation = await database_fingerprint(target);
  // 只读 WAL 连接可能创建空 WAL 和 SHM；忽略本次安全备份产生的空 sidecar，主库与非空 WAL 仍须一致。
  // 确认后的检查继续使用完整 fingerprint，不能把后续写入或文件替换也忽略。
  const primary_facts = (value: string) => (JSON.parse(value) as unknown[][])
    .filter((entry) => entry[0] !== "-shm")
    .map((entry) => entry[0] === "-wal" && (entry[1] === "absent" || entry[3] === 0) ? ["-wal", "empty"] : entry);
  if (JSON.stringify(primary_facts(before_safety)) !== JSON.stringify(primary_facts(before_confirmation))) {
    throw new Error(`Database changed during safety backup; no restore performed. Safety backup: ${safety_backup.backup_dir}`);
  }
  const preview: SqliteRestorePreview = { backup, database_path: target, safety_backup };
  if (!await interaction.confirm(preview)) return { ...preview, restored: false };
  await assert_release_service_stopped(server);
  backup = await verify_sqlite_snapshot(backup.backup_dir, source.fed_id);
  if (await require_sqlite_file(target) !== target || await database_fingerprint(target) !== before_confirmation) {
    throw new Error(`Database changed during confirmation; no restore performed. Safety backup: ${safety_backup.backup_dir}`);
  }
  const staging = join(dirname(target), `.downcity-restore-${randomUUID()}.sqlite`);
  let replaced = false;
  let restore_error: Error | undefined;
  try {
    await writeFile(staging, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    const input = new Database(backup.database_path, { readonly: true, fileMustExist: true });
    try { await input.backup(staging); } finally { input.close(); }
    await chmod(staging, 0o600);
    const staged = new Database(staging, { fileMustExist: true });
    try {
      if (staged.pragma("journal_mode = DELETE", { simple: true }) !== "delete") throw new Error("Restore snapshot is not standalone");
      assert_sqlite_integrity(staged);
    } finally { staged.close(); }
    await assert_no_sqlite_sidecars(staging);
    // 所有可能取消的输入与大文件准备已完成，再次确认不会由系统恢复旧实例。
    await assert_release_service_stopped(server);
    if (await database_fingerprint(target) !== before_confirmation) throw new Error("Database changed before replacement");
    const current = new Database(target, { fileMustExist: true, timeout: 5_000 });
    try {
      const checkpoint = current.pragma("wal_checkpoint(TRUNCATE)") as Array<{ /** SQLite checkpoint 是否被其他连接阻塞。 */ busy: number }>;
      if (checkpoint.some((row) => row.busy !== 0)) throw new Error("Database checkpoint is blocked by another connection");
      if (current.pragma("journal_mode = DELETE", { simple: true }) !== "delete") throw new Error("Database is still held by another connection");
      current.exec("BEGIN EXCLUSIVE");
      try { assert_sqlite_integrity(current); } finally { current.exec("ROLLBACK"); }
    } finally { current.close(); }
    await assert_no_sqlite_sidecars(target);
    await sync_snapshot_path(staging);
    await rename(staging, target);
    replaced = true;
    await sync_snapshot_path(dirname(target));
    return { backup, database_path: target, safety_backup, restored: true };
  } catch (error) {
    restore_error = new Error(`${replaced ? "Database replacement completed; final durability confirmation failed" : "Database restore did not replace the database"}. Safety backup: ${safety_backup.backup_dir}`, { cause: error });
    throw restore_error;
  } finally {
    // 清理全部候选文件；清理失败也必须保留替换事实、安全备份位置及原始失败。
    const cleanup_results = await Promise.allSettled(["", "-wal", "-shm", "-journal"].map((suffix) => rm(`${staging}${suffix}`, { force: true })));
    const cleanup_errors = cleanup_results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (cleanup_errors.length) {
      throw new AggregateError([...(restore_error ? [restore_error] : []), ...cleanup_errors],
        `${replaced ? "Database replacement completed" : "Database restore did not replace the database"}; restore staging cleanup failed${restore_error ? " after a restore failure" : ""}. Safety backup: ${safety_backup.backup_dir}`);
    }
  }
}
