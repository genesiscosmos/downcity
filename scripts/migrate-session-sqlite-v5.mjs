/**
 * @file 将现有 Session SQLite v3/v4 一次性迁移为 v5。
 *
 * 背景（中文）
 * - v4 -> v5 把请求记账从 User Message 的 `data` Part 移入消息级 `messages.meta` 列，
 *   并删除承载它的 Part；`prompt_power_fingerprint` 不再保留（它是 `powers` 的派生摘要）。
 *   这条迁移此前只在运行时内联执行：用户点开哪条会话，哪条才升级。库多了以后，
 *   每个库的首次打开都要额外背一次一次性开销。
 * - 本脚本把这件事前移成一次离线批处理，让运行时的打开路径回到纯读取。
 *
 * 与运行时的关系（中文）
 * - 迁移实现直接复用 `packages/agent` 的编译产物 `migrate_session_storage`，
 *   不在这里重写一份，避免离线脚本与运行时逻辑分叉。
 * - 迁移后的收尾（执行 schema SQL、写回 `user_version`）与
 *   `SqliteSessionStorage.initialize_storage` 保持同一顺序，使迁移结果与
 *   「运行时第一次打开」得到的状态完全一致。
 *
 * 使用方式
 *   node public/scripts/migrate-session-sqlite-v5.mjs --dry-run
 *   node public/scripts/migrate-session-sqlite-v5.mjs
 *
 * 前提
 * - 建议先退出 Desktop：迁移需要对这些库取得写锁，运行中的应用会与之争用。
 *   正在被占用的库会跳过并在结果中标记，可在关闭应用后重跑。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** 目标 schema 版本。 */
const TARGET_SCHEMA_VERSION = 5;

/** 可原地升级的来源版本。 */
const MIGRATABLE_VERSIONS = new Set([3, 4]);

const require = createRequire(import.meta.url);
/** 仓库内 Session 运行时包根目录（本脚本位于 <repo>/public/scripts）。 */
const scripts_directory = path.dirname(fileURLToPath(import.meta.url));
const agent_package_directory = path.resolve(scripts_directory, "../packages/agent");

/** 载入运行时使用的真实迁移实现与 schema。 */
function load_runtime_migration() {
  const migration = require(path.join(agent_package_directory, "bin/session/storage/SessionStorageMigration.js"));
  const schema = require(path.join(agent_package_directory, "bin/session/storage/SessionStorageSchema.js"));
  if (typeof migration.migrate_session_storage !== "function") {
    throw new Error("packages/agent/bin 缺少 migrate_session_storage：请先在 public/packages/agent 执行 pnpm build");
  }
  if (schema.SESSION_STORAGE_SCHEMA_VERSION !== TARGET_SCHEMA_VERSION) {
    throw new Error(
      `运行时 schema 版本为 ${String(schema.SESSION_STORAGE_SCHEMA_VERSION)}，与本脚本目标 ${String(TARGET_SCHEMA_VERSION)} 不一致`,
    );
  }
  return { migrate_session_storage: migration.migrate_session_storage, schema_sql: schema.SESSION_STORAGE_SCHEMA_SQL };
}

/** 解析一次性迁移脚本参数。 */
export function parse_arguments(arguments_) {
  const input = {
    /** Downcity 数据根目录。 */
    root_path: path.join(os.homedir(), ".downcity"),
    /** 仅扫描指定 Agent。 */
    agent_id: undefined,
    /** 仅扫描指定 Session。 */
    session_id: undefined,
    /** 仅报告将要执行的改动，不写盘。 */
    dry_run: false,
    /**
     * 迁移前备份根目录；为空字符串表示不备份。
     *
     * 迁移会重写 `message_parts` 约束并删除记账 Part，属于不可逆改动，
     * 因此默认保留一份迁移前副本。
     */
    backup_directory: undefined,
    /** 单库等待写锁的毫秒数。 */
    busy_timeout_ms: 5000,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") input.dry_run = true;
    else if (argument === "--no-backup") input.backup_directory = "";
    else if (argument === "--root" && arguments_[index + 1]) input.root_path = arguments_[++index];
    else if (argument === "--agent" && arguments_[index + 1]) input.agent_id = arguments_[++index];
    else if (argument === "--session" && arguments_[index + 1]) input.session_id = arguments_[++index];
    else if (argument === "--backup-dir" && arguments_[index + 1]) input.backup_directory = arguments_[++index];
    else if (argument === "--busy-timeout-ms" && arguments_[index + 1]) input.busy_timeout_ms = Number(arguments_[++index]);
    else throw new Error(`未知参数：${String(argument)}`);
  }
  return input;
}

/**
 * 迁移指定数据根下的全部 Session 数据库。
 *
 * 返回逐库结果与汇总计数，供脚本输出与调用方断言。
 */
export async function migrate_session_sqlite_v5(input) {
  const { migrate_session_storage, schema_sql } = load_runtime_migration();
  const root_path = path.resolve(input.root_path);
  const agents_path = path.join(root_path, "agents");
  const database_paths = (await find_session_databases(agents_path))
    .filter((database_path) => matches_selection(database_path, agents_path, input));
  const backup_root = input.dry_run || !input.backup_directory
    ? undefined
    : path.join(input.backup_directory, format_timestamp(new Date()));
  const result = {
    root_path,
    dry_run: Boolean(input.dry_run),
    backup_directory: backup_root,
    scanned_databases: database_paths.length,
    migrated_databases: 0,
    skipped_databases: 0,
    locked_databases: 0,
    failed_databases: 0,
    databases: [],
  };
  for (const database_path of database_paths) {
    const migration = await migrate_database({
      database_path,
      root_path,
      dry_run: Boolean(input.dry_run),
      backup_root,
      busy_timeout_ms: input.busy_timeout_ms,
      migrate_session_storage,
      schema_sql,
    });
    result.databases.push(migration);
    if (migration.status === "migrated") result.migrated_databases += 1;
    else if (migration.status === "locked") result.locked_databases += 1;
    else if (migration.status === "failed") result.failed_databases += 1;
    else result.skipped_databases += 1;
  }
  return result;
}

/** 递归查找 Agent 私有目录下名为 session.db 的文件。 */
async function find_session_databases(directory_path) {
  const entries = await fs.readdir(directory_path, { withFileTypes: true })
    .catch((error) => (error?.code === "ENOENT" ? [] : Promise.reject(error)));
  const output = [];
  for (const entry of entries) {
    // 跳过隐藏目录：备份目录即以 `.` 开头，它不是 Session 数据，
    // 否则重跑迁移会把上次的备份当作待迁移库再处理一遍。
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      output.push(...await find_session_databases(path.join(directory_path, entry.name)));
    } else if (entry.isFile() && entry.name === "session.db") {
      output.push(path.join(directory_path, entry.name));
    }
  }
  return output.sort((left, right) => left.localeCompare(right));
}

/**
 * 判断一个数据库是否落在 `--agent` / `--session` 选定的范围内。
 *
 * 目录形状固定为 `agents/<agent_id>/<sessions|archived-sessions>/<origin>/<session_id>/session.db`，
 * 因此在收集完成后按相对路径分段过滤，比在递归里逐层判断更不容易出错。
 */
function matches_selection(database_path, agents_path, input) {
  if (!input.agent_id && !input.session_id) return true;
  const [agent_id, , , session_id] = path.relative(agents_path, database_path).split(path.sep);
  if (input.agent_id && agent_id !== input.agent_id) return false;
  if (input.session_id && session_id !== input.session_id) return false;
  return true;
}

/**
 * 迁移单个 Session 数据库。
 *
 * 顺序与运行时一致：先合并 WAL，再在迁移函数自身的写事务内升级，最后执行 schema SQL
 * 并写回版本号。迁移失败时由迁移函数内部回滚，磁盘保持原状。
 */
async function migrate_database(options) {
  const { database_path, root_path, dry_run, backup_root, busy_timeout_ms, migrate_session_storage, schema_sql } = options;
  const relative_path = path.relative(root_path, database_path);
  let database = null;
  try {
    database = new DatabaseSync(database_path);
    database.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${String(busy_timeout_ms)};`);
    const from_version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (from_version === TARGET_SCHEMA_VERSION) {
      return { database_path: relative_path, from_version, to_version: from_version, status: "skipped", reason: "already at target version" };
    }
    if (!MIGRATABLE_VERSIONS.has(from_version)) {
      return { database_path: relative_path, from_version, status: "skipped", reason: `unsupported version ${String(from_version)}` };
    }
    if (dry_run) {
      return { database_path: relative_path, from_version, to_version: TARGET_SCHEMA_VERSION, status: "migrated", dry_run: true };
    }

    // 先合并 WAL：让随后的备份副本包含完整数据，也避免迁移依赖旁挂日志。
    const checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (Number(checkpoint?.busy ?? 0) !== 0) {
      return { database_path: relative_path, from_version, status: "locked", reason: "WAL checkpoint busy: 库正在被其他进程使用" };
    }

    if (backup_root) await backup_database(database_path, root_path, backup_root);

    const message_count_before = read_count(database, "messages");
    const part_count_before = read_count(database, "message_parts");
    const bookkeeping_before = read_bookkeeping_part_count(database);

    migrate_session_storage(database, from_version);
    database.exec(schema_sql);
    database.exec(`PRAGMA user_version = ${String(TARGET_SCHEMA_VERSION)}`);

    const to_version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    const integrity = database.prepare("PRAGMA integrity_check").get()?.integrity_check;
    const foreign_key_errors = database.prepare("PRAGMA foreign_key_check").all().length;
    const message_count_after = read_count(database, "messages");
    const part_count_after = read_count(database, "message_parts");
    const bookkeeping_after = read_bookkeeping_part_count(database);

    // 迁移只改变记账承载方式：消息数必须逐条保留，记账 Part 必须清空。
    const valid = to_version === TARGET_SCHEMA_VERSION
      && integrity === "ok"
      && foreign_key_errors === 0
      && message_count_after === message_count_before
      && bookkeeping_after === 0;
    if (!valid) {
      return {
        database_path: relative_path,
        from_version,
        to_version,
        status: "failed",
        reason: `迁移后校验未通过：integrity=${String(integrity)} fk=${String(foreign_key_errors)} messages=${String(message_count_before)}->${String(message_count_after)} bookkeeping=${String(bookkeeping_after)}`,
      };
    }
    return {
      database_path: relative_path,
      from_version,
      to_version,
      status: "migrated",
      message_count: message_count_after,
      ...(bookkeeping_before > 0 ? { folded_bookkeeping_parts: bookkeeping_before } : {}),
      ...(part_count_after !== part_count_before ? { parts: `${String(part_count_before)}->${String(part_count_after)}` } : {}),
    };
  } catch (error) {
    const message = String(error?.message || error);
    // SQLITE_BUSY 说明库被运行中的应用占用；这不是数据错误，可在关闭应用后重跑。
    if (/busy|locked/i.test(message)) {
      return { database_path: relative_path, status: "locked", reason: message };
    }
    return { database_path: relative_path, status: "failed", reason: message };
  } finally {
    database?.close();
  }
}

/** 复制迁移前的数据库副本，保留相对目录结构。 */
async function backup_database(database_path, root_path, backup_root) {
  const target_path = path.join(backup_root, path.relative(root_path, database_path));
  await fs.mkdir(path.dirname(target_path), { recursive: true });
  await fs.copyFile(database_path, target_path);
}

/** 读取表行数；表不存在时返回 0。 */
function read_count(database, table_name) {
  try {
    return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table_name}`).get()?.count ?? 0);
  } catch {
    return 0;
  }
}

/** 统计仍以 Part 形式承载请求记账的条数（迁移后应为 0）。 */
function read_bookkeeping_part_count(database) {
  try {
    return Number(database.prepare(`
      SELECT COUNT(*) AS count FROM message_parts
      WHERE type = 'data'
        AND json_extract(content, '$.data_type') IN (
          'session_prompt_actor', 'prompt_powers',
          'prompt_power_fingerprint', 'session_callback')
    `).get()?.count ?? 0);
  } catch {
    return 0;
  }
}

/** 生成备份目录用的时间戳。 */
function format_timestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 汇总输出，避免把逐库结果全部打到终端。 */
function summarize(result) {
  const lines = [
    `root: ${result.root_path}${result.dry_run ? " (dry-run)" : ""}`,
    `scanned=${result.scanned_databases} migrated=${result.migrated_databases} skipped=${result.skipped_databases} locked=${result.locked_databases} failed=${result.failed_databases}`,
  ];
  if (result.backup_directory) lines.push(`backup: ${result.backup_directory}`);
  const notable = result.databases.filter((item) => item.status !== "skipped" && item.status !== "migrated");
  for (const item of result.databases.filter((item) => item.status === "migrated" && item.folded_bookkeeping_parts)) {
    lines.push(`  folded ${String(item.folded_bookkeeping_parts)} bookkeeping parts -> meta: ${item.database_path}`);
  }
  for (const item of notable) lines.push(`  ${item.status}: ${item.database_path} (${item.reason})`);
  return lines.join("\n");
}

const current_file_path = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === current_file_path) {
  const input = parse_arguments(process.argv.slice(2));
  if (input.backup_directory === undefined) {
    // 默认放在 `agents` 下的隐藏目录：`~/.downcity` 根目录本身不可写，
    // 而隐藏目录会被扫描跳过，因此备份不会被下一次迁移当成待处理库。
    input.backup_directory = path.join(path.resolve(input.root_path), "agents", ".session-db-backups");
  }
  const result = await migrate_session_sqlite_v5(input);
  console.log(summarize(result));
  if (result.failed_databases > 0 || result.locked_databases > 0) process.exitCode = 1;
}
