/**
 * City 本地数据库重置能力。
 *
 * 该模块只删除 SQLite 主文件及其 WAL/SHM 伴随文件，不理解数据库业务表，
 * 也不删除环境变量、加密密钥、Plugin 制品或 Workspace/Session 文件。
 */

import fs from "fs-extra";
import {
  get_local_database_path,
  resolve_local_root_path,
} from "@downcity/local";

/** 删除当前 City 数据库文件，并返回实际删除的绝对路径。 */
export async function reset_city_database(root_path_input?: string): Promise<string[]> {
  const root_path = resolve_local_root_path(root_path_input);
  const database_path = get_local_database_path(root_path);
  const database_files = [database_path, `${database_path}-wal`, `${database_path}-shm`];
  const existing_files = (await Promise.all(database_files.map(async (file_path) =>
    await fs.pathExists(file_path) ? file_path : null
  ))).filter((file_path): file_path is string => file_path !== null);
  await Promise.all(database_files.map(async (file_path) => await fs.remove(file_path)));
  return existing_files;
}
