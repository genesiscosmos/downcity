/**
 * 本地 SQLite 备份与恢复命令，目标只使用本次选择的独立部署。
 * 同 Fed 操作锁覆盖预检、快照、确认及替换，不修改运行配置、发布版本或 City 连接。
 */
import { isAbsolute } from "node:path";
import { read_server_by_fed_id, updateServer, type ServerProfile } from "../core/session.js";
import { resolve_downtown_target } from "./DowntownTarget.js";
import { with_local_release_lock } from "../deploy/release/LocalReleaseStore.js";
import { read_local_runtime_config } from "../deploy/release/LocalRuntimeConfig.js";
import { verify_node_release } from "../deploy/release/NodeReleaseBuilder.js";
import { create_sqlite_snapshot, require_sqlite_file } from "../deploy/release/SqliteSnapshots.js";
import { restore_sqlite_snapshot } from "../deploy/release/SqliteRestore.js";
import type { DowntownBackupOptions, DowntownRestoreOptions, SqliteBackupSource, SqliteRestorePreview } from "../types/SqliteBackup.js";
import { confirm, isCancel } from "../tui/Prompts.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";

/** 核对登记的 release 与持久运行配置，只读取绝对 SQLite 路径，不推断源码目录。 */
export async function resolve_database_source(server: ServerProfile): Promise<SqliteBackupSource> {
  if (server.target !== "local" || !server.fed_id || !server.release_id || !server.release_dir || !server.runtime_config_path) {
    throw new CliError({ title: "Database operations require an independent local Downtown deployment" });
  }
  const manifest = await verify_node_release(server.release_dir, server.fed_id, server.release_id);
  const env = read_local_runtime_config(server.runtime_config_path);
  if (!env.DATABASE_PATH || !isAbsolute(env.DATABASE_PATH)
    || env.DOWNCITY_DOWNTOWN_DATABASE_URL !== `file:${env.DATABASE_PATH}`) {
    throw new CliError({ title: "The persisted runtime configuration must identify one absolute SQLite database" });
  }
  const database_path = await require_sqlite_file(env.DATABASE_PATH);
  return { fed_id: server.fed_id, database_path, release_id: manifest.release_id, app_version: manifest.app_version };
}

/** 在线一致性备份，不停止应用、不复制未合并的主库文件。 */
export async function run_downtown_backup(options: DowntownBackupOptions): Promise<void> {
  const selected = await resolve_downtown_target(options);
  if (!selected) return;
  if (selected.target !== "local" || !selected.fed_id) throw new CliError({ title: "SQLite backup only supports registered local deployments" });
  await with_local_release_lock(selected.fed_id, async () => {
    const server = current_server(selected);
    const source = await resolve_database_source(server);
    try {
      const backup = await create_sqlite_snapshot(source);
      emitCliBlock({ tone: "success", title: "SQLite backup completed", facts: [
        { label: "Fed ID", value: source.fed_id }, { label: "backup", value: backup.backup_dir },
        { label: "release", value: source.release_id }, { label: "application version", value: source.app_version },
        { label: "bytes", value: String(backup.metadata.size_bytes) }, { label: "integrity", value: "ok" },
      ], note: "Backup contents may include private user data and credentials. Files are restricted to the current user." });
    } catch { throw new CliError({ title: "SQLite backup failed", note: "No incomplete snapshot is accepted as a completed backup. Inspect database permissions, locks and disk space." }); }
  });
}

/** 恢复必须先确认持久停止并保全当前库；确认取消保留安全备份，不替换数据库。 */
export async function run_downtown_restore(options: DowntownRestoreOptions): Promise<void> {
  const selected = await resolve_downtown_target(options);
  if (!selected) return;
  if (selected.target !== "local" || !selected.fed_id) throw new CliError({ title: "SQLite restore only supports registered local deployments" });
  if (!options.dry_run && !options.yes && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new CliError({ title: "Restore confirmation is required", fix: "Preview with --dry-run or explicitly authorize replacement with --yes." });
  }
  await with_local_release_lock(selected.fed_id, async () => {
    const server = current_server(selected);
    const source = await resolve_database_source(server);
    let safety_path: string | undefined;
    try {
      const result = await restore_sqlite_snapshot(server, source, options.path, {
        confirm: async (preview) => {
          safety_path = preview.safety_backup?.backup_dir;
          show_restore_preview(server, preview);
          if (options.yes) return true;
          const accepted = await confirm({ message: "Replace this stopped Downtown database? Application version is not changed; verify schema compatibility.", initialValue: false });
          return !isCancel(accepted) && accepted === true;
        },
      }, options.dry_run === true);
      if (options.dry_run) { show_restore_preview(server, result); return; }
      if (!result.restored) {
        emitCliBlock({ title: "SQLite restore cancelled", facts: [{ label: "safety backup", value: result.safety_backup!.backup_dir }],
          note: "The deployed database was not replaced. The service remains stopped." });
        return;
      }
      try { updateServer(server.base_url, { ...server, status: "stopped" }); }
      catch { throw new CliError({ title: "Database restored, but the stopped registry status could not be saved",
        note: `Safety backup: ${result.safety_backup!.backup_dir}. Inspect status before starting the service.` }); }
      emitCliBlock({ tone: "success", title: "SQLite restore completed", facts: [
        { label: "Fed ID", value: source.fed_id }, { label: "database", value: result.database_path },
        { label: "restored backup", value: result.backup.metadata.backup_id },
        { label: "safety backup", value: result.safety_backup!.backup_dir },
      ], note: "The service remains stopped. Release, runtime configuration and City connection were not changed. Start it only after checking application/schema compatibility." });
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError({ title: "SQLite restore failed", note: error instanceof Error ? error.message : "Restore could not be completed",
        fix: safety_path ? `Inspect the stopped service and safety backup at ${safety_path}. Do not automatically retry or start.`
          : "Inspect the backup, database and system stop status. No service was started by this command." });
    }
  });
}

/** 目标选择后取得锁，再查当前记录，禁止用过期 URL 指向另一部署。 */
function current_server(selected: ServerProfile): ServerProfile {
  const server = read_server_by_fed_id(selected.fed_id!, "local");
  if (!server || server.base_url !== selected.base_url) throw new CliError({ title: "Downtown deployment changed; select it again" });
  return server;
}

/** 只展示路径和身份，不输出备份中的数据、Token 或管理员凭据。 */
function show_restore_preview(server: ServerProfile, preview: SqliteRestorePreview): void {
  emitCliBlock({ title: "SQLite restore plan", facts: [
    { label: "Fed ID", value: server.fed_id! }, { label: "database", value: preview.database_path },
    { label: "backup", value: preview.backup.backup_dir }, { label: "backup time", value: preview.backup.metadata.created_at },
    { label: "backup release", value: preview.backup.metadata.release_id }, { label: "current release", value: server.release_id! },
    { label: "integrity", value: "ok" }, { label: "safety backup", value: preview.safety_backup?.backup_dir ?? "not created in dry run" },
  ], note: "Restore replaces database contents, including database-stored accounts, sessions and configuration. It does not switch application releases or restart the service." });
}
