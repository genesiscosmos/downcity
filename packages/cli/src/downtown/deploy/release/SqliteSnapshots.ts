/**
 * 一致性 SQLite 快照：在线 backup API 包含 WAL，完成标记只在摘要与完整性验证后写入。
 * 不输出数据内容；所有快照目录为 0700、文件 0600。恢复输入必须为独立、无 sidecar 的备份。
 */
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getPlatformRootDirPath } from "@/city/process/registry/CityPaths.js";
import type { SqliteBackup, SqliteBackupMetadata, SqliteBackupSource } from "../../types/SqliteBackup.js";

/** 只接受现有普通文件，不跟随数据库叶子软链接，不创建缺失数据库。 */
export async function require_sqlite_file(file_path: string): Promise<string> {
  if (!isAbsolute(file_path)) throw new Error("SQLite database path must be absolute");
  const info = await lstat(file_path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("SQLite database must be a regular file");
  return await realpath(file_path);
}

/** 流式计算文件摘要，避免把整个数据库读入内存。 */
export async function snapshot_digest(file_path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file_path)) digest.update(chunk);
  return digest.digest("hex");
}

/** 在报告快照完成或替换成功前同步文件与目录，避免仅依赖内核写入缓存。 */
export async function sync_snapshot_path(file_path: string): Promise<void> {
  const handle = await open(file_path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

/** 完整检查结果必须唯一为 ok；不将内部页或表诊断输出到 CLI。 */
export function assert_sqlite_integrity(database: Database.Database): void {
  const rows = database.pragma("integrity_check") as Array<Record<string, unknown>>;
  if (rows.length !== 1 || Object.values(rows[0]!).length !== 1 || Object.values(rows[0]!)[0] !== "ok") {
    throw new Error("SQLite integrity check failed");
  }
}

/** 检查快照旁没有任何仍需合并的 WAL、SHM 或 journal 文件。 */
export async function assert_no_sqlite_sidecars(file_path: string): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { await lstat(`${file_path}${suffix}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    throw new Error("SQLite sidecar files prevent a safe offline replacement");
  }
}

/** 创建独立、可恢复的在线备份；不改变源库 journal 模式或 checkpoint。 */
export async function create_sqlite_snapshot(source: SqliteBackupSource,
  purpose: SqliteBackupMetadata["purpose"] = "explicit"): Promise<SqliteBackup> {
  if (!/^fed_[a-zA-Z0-9_-]+$/u.test(source.fed_id)) throw new Error("Invalid Downtown ID");
  const source_path = await require_sqlite_file(source.database_path);
  const created_at = new Date().toISOString();
  const backup_id = `backup_${created_at.replace(/[-:.]/gu, "")}_${randomUUID()}`;
  const backup_root = join(getPlatformRootDirPath(), "downtown", "backups", source.fed_id);
  await mkdir(backup_root, { recursive: true, mode: 0o700 });
  if (!(await lstat(backup_root)).isDirectory()) throw new Error("Backup directory must be a real directory");
  await chmod(backup_root, 0o700);
  const staging = join(backup_root, `.pending_${backup_id}`);
  const backup_dir = join(backup_root, backup_id);
  await mkdir(staging, { mode: 0o700 });
  const staging_database = join(staging, "database.sqlite");
  try {
    await writeFile(staging_database, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    const database = new Database(source_path, { readonly: true, fileMustExist: true, timeout: 5_000 });
    try {
      const deadline = Date.now() + 60_000;
      await database.backup(staging_database, { progress: () => {
        if (Date.now() > deadline) throw new Error("SQLite backup deadline exceeded");
        return 128;
      } });
    } finally { database.close(); }
    await chmod(staging_database, 0o600);
    const snapshot = new Database(staging_database, { fileMustExist: true });
    try {
      const mode = snapshot.pragma("journal_mode = DELETE", { simple: true });
      if (mode !== "delete") throw new Error("Unable to finalize a standalone SQLite snapshot");
      assert_sqlite_integrity(snapshot);
    } finally { snapshot.close(); }
    await assert_no_sqlite_sidecars(staging_database);
    const metadata: SqliteBackupMetadata = { schema: 1, backup_id, fed_id: source.fed_id, created_at,
      app_version: source.app_version, release_id: source.release_id, purpose,
      database_file: "database.sqlite", size_bytes: (await lstat(staging_database)).size,
      sha256: await snapshot_digest(staging_database), integrity_check: "ok" };
    const metadata_path = join(staging, "backup.json");
    await writeFile(metadata_path, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await sync_snapshot_path(staging_database);
    await sync_snapshot_path(metadata_path);
    await sync_snapshot_path(staging);
    await rename(staging, backup_dir);
    await sync_snapshot_path(backup_root);
    return { backup_dir, database_path: join(backup_dir, "database.sqlite"), metadata };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** 核对完整备份的归属、摘要、大小和离线完整性，不从元数据接受任意数据库路径。 */
export async function verify_sqlite_snapshot(input_path: string, fed_id: string): Promise<SqliteBackup> {
  const absolute_path = resolve(input_path);
  const input_stat = await lstat(absolute_path);
  if (input_stat.isSymbolicLink()) throw new Error("Backup input must not be a symbolic link");
  const backup_dir = input_stat.isDirectory() ? absolute_path : basename(absolute_path) === "database.sqlite" ? dirname(absolute_path) : "";
  if (!backup_dir || !(await lstat(backup_dir)).isDirectory()) throw new Error("Select a completed SQLite backup directory");
  const metadata_path = join(backup_dir, "backup.json");
  const metadata_stat = await lstat(metadata_path);
  if (!metadata_stat.isFile() || metadata_stat.size > 64 * 1024) throw new Error("Backup completion metadata is missing or unsafe");
  let value: SqliteBackupMetadata;
  try { value = JSON.parse(await readFile(metadata_path, "utf8")) as SqliteBackupMetadata; }
  catch { throw new Error("Backup completion metadata is not valid JSON"); }
  if (!value || typeof value !== "object" || value.schema !== 1 || value.fed_id !== fed_id
    || typeof value.backup_id !== "string" || !/^backup_[A-Za-z0-9_-]+$/u.test(value.backup_id)
    || basename(backup_dir) !== value.backup_id
    || value.database_file !== "database.sqlite" || value.integrity_check !== "ok"
    || !["explicit", "before_restore"].includes(value.purpose)
    || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))
    || typeof value.release_id !== "string" || !value.release_id || typeof value.app_version !== "string" || !value.app_version
    || !Number.isSafeInteger(value.size_bytes) || value.size_bytes < 1
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    throw new Error("Backup metadata or Downtown ownership is invalid");
  }
  const database_path = await require_sqlite_file(join(backup_dir, "database.sqlite"));
  await assert_no_sqlite_sidecars(database_path);
  if ((await lstat(database_path)).size !== value.size_bytes || await snapshot_digest(database_path) !== value.sha256) {
    throw new Error("SQLite backup checksum or size mismatch");
  }
  const database = new Database(database_path, { readonly: true, fileMustExist: true });
  try { assert_sqlite_integrity(database); } finally { database.close(); }
  return { backup_dir, database_path, metadata: value };
}
