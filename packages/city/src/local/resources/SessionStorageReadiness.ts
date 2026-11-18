/**
 * 本地宿主的 Session 格式门禁。
 *
 * 在执行装配前只读检查迁移标记、数据库格式和全根身份；不初始化或修复数据。
 * 迁移中间态即使已经发布部分 Agent DB 也不能进入正常执行。
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFile as read_file, readdir, lstat } from "node:fs/promises";
import { AGENT_SESSION_SCHEMA_VERSION, assert_agent_session_schema } from "@downcity/agent";

/** 离线工具与宿主共享的完成标记，写入由独占根租约保护。 */
export const SESSION_STORAGE_MARKER = "session-storage.json";

/** 只吞不存在；权限、损坏标记和非普通目录必须显式失败。 */
async function exists(file_path: string): Promise<boolean> {
  try {
    const stat = await lstat(file_path);
    if (stat.isSymbolicLink()) throw new Error("session_storage_path_invalid");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 未迁移旧根及未完成批次拒绝执行；新建空根无需伪造迁移记录。 */
export async function assert_session_storage_ready(root_path: string): Promise<void> {
  const marker_path = path.join(root_path, SESSION_STORAGE_MARKER);
  let migrated = false;
  if (await exists(marker_path)) {
    let marker;
    try { marker = JSON.parse(await read_file(marker_path, "utf8")); }
    catch { throw new Error("session_storage_marker_invalid"); }
    if (marker?.format_version !== AGENT_SESSION_SCHEMA_VERSION || marker?.state !== "ready") {
      throw new Error(`session_migration_required: 数据根需要完成离线迁移或继续原批次；root_path=${root_path}; actual_version=${marker?.format_version}; expected_version=${AGENT_SESSION_SCHEMA_VERSION}; state=${marker?.state}`);
    }
    migrated = true;
  }
  const agents_path = path.join(root_path, "agents");
  if (!(await exists(agents_path))) return;
  const session_ids = new Set<string>();
  for (const entry of await readdir(agents_path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("session_storage_path_invalid");
    if (!entry.isDirectory()) continue;
    for (const partition of ["sessions", "archived-sessions"]) {
      if (await exists(path.join(agents_path, entry.name, partition))) {
        if (migrated && await exists(path.join(agents_path, entry.name, "sessions.db"))) continue;
        throw new Error(`session_migration_required: 检测到旧 Session 分库，请先完成离线转换；agent_id=${entry.name}; expected_version=${AGENT_SESSION_SCHEMA_VERSION}`);
      }
    }
    const database_path = path.join(agents_path, entry.name, "sessions.db");
    if (!(await exists(database_path))) continue;
    const database = new DatabaseSync(database_path, { readOnly: true });
    try {
      database.exec("PRAGMA busy_timeout=250; PRAGMA query_only=ON; BEGIN;");
      // 单库格式与拥有者由 Agent 存储层校验；City 只负责根状态和跨 Agent 身份。
      assert_agent_session_schema(database, entry.name);
      for (const row of database.prepare("SELECT session_id FROM sessions").iterate()) {
        const session_id = String(row.session_id);
        if (session_ids.has(session_id)) throw new Error("session_storage_identity_conflict: 数据根内存在重复 Session UUID");
        session_ids.add(session_id);
      }
    } finally { database.close(); }
  }
}
