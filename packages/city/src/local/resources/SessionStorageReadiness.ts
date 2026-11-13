/**
 * 本地宿主的 Session 格式门禁。
 *
 * 在执行装配前检查离线迁移的根标记和旧分区；不打开业务库、不初始化或修复数据。
 * 迁移中间态即使已经发布部分 Agent DB 也不能进入正常执行。
 */
import path from "node:path";
import { readFile as read_file, readdir, lstat } from "node:fs/promises";

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
    if (marker?.format_version !== 8 || marker?.state !== "ready") {
      throw new Error("session_migration_required: Session 存储迁移尚未完成，请退出宿主后检查离线迁移批次");
    }
    migrated = true;
  }
  const agents_path = path.join(root_path, "agents");
  if (!(await exists(agents_path))) return;
  for (const entry of await readdir(agents_path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("session_storage_path_invalid");
    if (!entry.isDirectory()) continue;
    for (const partition of ["sessions", "archived-sessions"]) {
      if (await exists(path.join(agents_path, entry.name, partition))) {
        if (migrated && await exists(path.join(agents_path, entry.name, "sessions.db"))) continue;
        throw new Error("session_migration_required: 检测到旧 Session 分库，请先完成 v8 离线迁移；尚未启动 Agent、Power 或工作恢复");
      }
    }
  }
}
