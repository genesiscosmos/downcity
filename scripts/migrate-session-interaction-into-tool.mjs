/**
 * @file 把旧格式的独立 Interaction Part 一次性并入所属 Tool Part。
 *
 * Runtime 与 Desktop 不导入本文件，也不存在读时自动迁移。旧版本把一次交互持久化为
 * 与 Tool Part 并列的 `message_parts` 行（`type = 'interaction'`）；当前模型把交互
 * 作为 Tool Part 的 `interactions` 字段，编解码会直接拒绝旧行，因此需要本脚本。
 *
 * 归属关系取自旧行 content 内的 `request.source.tool_call_id`：它指向同一条 message
 * 中唯一的 Tool Part，所以迁移是确定的，不需要猜测。同一 Tool 下的多个交互按旧行的
 * `sequence` 排序后写入数组。
 *
 * 脚本按数据库原子执行：先备份 `session.db`，再在单个事务内改写 Tool Part content 并
 * 删除旧行；任一步失败即整体回滚。没有旧行的数据库不做任何写入，也不产生备份。
 */

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/** 备份文件与 session.db 同级，避免迁移后找不到原始数据。 */
const BACKUP_SUFFIX = ".interactions-v1.bak";

/** Part 身份字段，不属于 Interaction 领域模型，迁移时从旧 content 中剔除。 */
const PART_IDENTITY_KEYS = ["part_id", "sequence", "step_id", "type"];

/** 解析一次性迁移脚本参数。 */
export function parse_arguments(arguments_) {
  const input = {
    root_path: path.join(os.homedir(), ".downcity"),
    dry_run: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") input.dry_run = true;
    else if (argument === "--root" && arguments_[index + 1]) {
      input.root_path = arguments_[++index];
    } else {
      throw new Error(`未知参数：${String(argument)}`);
    }
  }
  return input;
}

/** 扫描指定 Downcity 数据根并迁移全部 Session 数据库。 */
export async function migrate_session_interactions(input) {
  const database_paths = await find_session_databases(
    path.join(path.resolve(input.root_path), "agents"),
  );
  const result = {
    scanned_databases: database_paths.length,
    migrated_databases: 0,
    skipped_databases: 0,
    blocked_databases: 0,
    failed_databases: 0,
    migrated_interactions: 0,
    dry_run: Boolean(input.dry_run),
    databases: [],
  };
  for (const database_path of database_paths) {
    const migration = run_database(database_path, Boolean(input.dry_run));
    result.databases.push(migration);
    result.migrated_interactions += migration.migrated_interactions;
    if (migration.status === "migrated") result.migrated_databases += 1;
    else if (migration.status === "blocked") result.blocked_databases += 1;
    else if (migration.status === "failed") result.failed_databases += 1;
    else result.skipped_databases += 1;
  }
  return result;
}

/**
 * 迁移单个数据库，并把单库失败隔离在库内。
 *
 * Desktop 可能正开着这些数据库，因此单个库拿不到写锁或出现意外错误时，不应中断
 * 整批迁移：记录失败原因并继续，由调用方决定是否重跑。
 */
function run_database(database_path, dry_run) {
  try {
    return migrate_database(database_path, dry_run);
  } catch (error) {
    const backup_path = `${database_path}${BACKUP_SUFFIX}`;
    return {
      database_path,
      status: "failed",
      legacy_interactions: 0,
      migrated_interactions: 0,
      unresolved: [],
      ...(fs.existsSync(backup_path) ? { backup_path } : {}),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 递归查找 Agent 私有目录下名为 session.db 的文件。 */
async function find_session_databases(directory_path) {
  const entries = await fsPromises.readdir(directory_path, { withFileTypes: true })
    .catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  const output = [];
  for (const entry of entries) {
    const entry_path = path.join(directory_path, entry.name);
    if (entry.isDirectory()) output.push(...await find_session_databases(entry_path));
    else if (entry.isFile() && entry.name === "session.db") output.push(entry_path);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

/** 迁移单个 Session 数据库。 */
function migrate_database(database_path, dry_run) {
  const plan = plan_database(database_path);
  if (plan.legacy_interactions === 0) {
    return { database_path, status: "skipped", legacy_interactions: 0, migrated_interactions: 0, unresolved: [] };
  }
  if (plan.unresolved.length > 0) {
    // 归属无法确定的旧行不能被猜测放置，也不应在读时被静默丢弃。
    return {
      database_path,
      status: "blocked",
      legacy_interactions: plan.legacy_interactions,
      migrated_interactions: 0,
      unresolved: plan.unresolved,
    };
  }
  if (dry_run) {
    return {
      database_path,
      status: "migrated",
      dry_run: true,
      legacy_interactions: plan.legacy_interactions,
      migrated_interactions: plan.legacy_interactions,
      unresolved: [],
    };
  }

  const backup_path = `${database_path}${BACKUP_SUFFIX}`;
  backup_database(database_path, backup_path);
  apply_plan(database_path, plan);
  return {
    database_path,
    status: "migrated",
    legacy_interactions: plan.legacy_interactions,
    migrated_interactions: plan.legacy_interactions,
    backup_path,
    unresolved: [],
  };
}

/**
 * 读取单个数据库的迁移计划，不写入任何内容。
 *
 * 返回的 assignments 已按 Tool Part 聚合，interactions 按旧行 sequence 升序。
 */
function plan_database(database_path) {
  const database = new DatabaseSync(database_path);
  try {
    // Desktop 可能同时持有连接：等待短暂写锁而不是立刻失败。
    database.exec("PRAGMA busy_timeout = 5000;");
    const legacy_rows = database
      .prepare(
        `SELECT part_id, message_id, sequence, content
         FROM message_parts
         WHERE type = 'interaction'
         ORDER BY message_id, sequence`,
      )
      .all();
    const plan = { legacy_interactions: legacy_rows.length, assignments: [], removal_ids: [], unresolved: [] };
    if (legacy_rows.length === 0) return plan;

    const tool_parts_by_message = read_tool_parts(database, legacy_rows);
    const assignments = new Map();
    for (const row of legacy_rows) {
      const interaction = parse_legacy_interaction(row);
      if (!interaction) {
        plan.unresolved.push({ part_id: row.part_id, reason: "content is not a JSON object" });
        continue;
      }
      const tool_call_id = interaction.request?.source?.tool_call_id;
      if (typeof tool_call_id !== "string" || tool_call_id.length === 0) {
        plan.unresolved.push({ part_id: row.part_id, reason: "request.source.tool_call_id is missing" });
        continue;
      }
      const tool_part = tool_parts_by_message.get(row.message_id)?.get(tool_call_id);
      if (!tool_part) {
        plan.unresolved.push({
          part_id: row.part_id,
          reason: `no Tool Part with tool_call_id ${tool_call_id} in message ${row.message_id}`,
        });
        continue;
      }
      const assignment = assignments.get(tool_part.part_id);
      if (assignment) assignment.interactions.push(interaction);
      else assignments.set(tool_part.part_id, { tool_part, interactions: [interaction] });
      plan.removal_ids.push(row.part_id);
    }
    plan.assignments = [...assignments.values()];
    return plan;
  } finally {
    database.close();
  }
}

/** 读取旧行所属 message 内的全部 Tool Part，并按 tool_call_id 建索引。 */
function read_tool_parts(database, legacy_rows) {
  const indexed = new Map();
  const message_ids = [...new Set(legacy_rows.map((row) => row.message_id))];
  const read = database.prepare(
    `SELECT part_id, message_id, content
     FROM message_parts
     WHERE type = 'tool' AND message_id = ?`,
  );
  for (const message_id of message_ids) {
    const by_call_id = new Map();
    for (const row of read.all(message_id)) {
      const content = parse_json_object(row.content);
      if (!content || typeof content.tool_call_id !== "string") continue;
      if (by_call_id.has(content.tool_call_id)) continue;
      by_call_id.set(content.tool_call_id, { part_id: row.part_id, content });
    }
    indexed.set(message_id, by_call_id);
  }
  return indexed;
}

/** 解析旧 Interaction 行 content，并剔除 Part 身份字段。 */
function parse_legacy_interaction(row) {
  const content = parse_json_object(row.content);
  if (!content) return null;
  const interaction = { ...content };
  for (const key of PART_IDENTITY_KEYS) delete interaction[key];
  return interaction;
}

/** 解析 JSON object 文本，失败或非 object 时返回 null。 */
function parse_json_object(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

/** 复制 session.db 作为迁移前备份，已存在备份时拒绝覆盖。 */
function backup_database(database_path, backup_path) {
  fs.copyFileSync(database_path, backup_path, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup_path, 0o600);
  // WAL 未落盘时一并保留，保证备份可以独立打开。
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(`${database_path}${suffix}`)) {
      fs.copyFileSync(`${database_path}${suffix}`, `${backup_path}${suffix}`);
      fs.chmodSync(`${backup_path}${suffix}`, 0o600);
    }
  }
}

/** 在单个事务内改写 Tool Part 并删除旧 Interaction 行。 */
function apply_plan(database_path, plan) {
  const database = new DatabaseSync(database_path);
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("BEGIN IMMEDIATE;");
    try {
      const update = database.prepare(
        "UPDATE message_parts SET content = ? WHERE part_id = ? AND type = 'tool'",
      );
      for (const assignment of plan.assignments) {
        const content = { ...assignment.tool_part.content };
        content.interactions = merge_interactions(content.interactions, assignment.interactions);
        update.run(JSON.stringify(content), assignment.tool_part.part_id);
      }
      const remove = database.prepare(
        "DELETE FROM message_parts WHERE part_id = ? AND type = 'interaction'",
      );
      for (const part_id of plan.removal_ids) remove.run(part_id);

      const remaining = database
        .prepare("SELECT count(*) AS count FROM message_parts WHERE type = 'interaction'")
        .get();
      if (Number(remaining?.count ?? 0) !== 0) {
        throw new Error(`Interaction 迁移后仍有旧行残留：${database_path}`);
      }
      const integrity = database.prepare("PRAGMA integrity_check").get();
      const foreign_key_errors = database.prepare("PRAGMA foreign_key_check").all();
      if (integrity?.integrity_check !== "ok" || foreign_key_errors.length > 0) {
        throw new Error(`Interaction 迁移后校验失败：${database_path}`);
      }
      database.exec("COMMIT;");
    } catch (error) {
      try { database.exec("ROLLBACK;"); } catch {}
      throw error;
    }
  } finally {
    database.close();
  }
}

/** 合并已有 interactions 与迁移结果，按 interaction_id 去重以支持重入。 */
function merge_interactions(existing, migrated) {
  const output = [];
  const seen = new Set();
  const items = [...(Array.isArray(existing) ? existing : []), ...migrated];
  for (const item of items) {
    const interaction_id = item?.interaction_id;
    if (typeof interaction_id === "string") {
      if (seen.has(interaction_id)) continue;
      seen.add(interaction_id);
    }
    output.push(item);
  }
  return output;
}

const current_file_path = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === current_file_path) {
  console.log(JSON.stringify(await migrate_session_interactions(
    parse_arguments(process.argv.slice(2)),
  ), null, 2));
}
