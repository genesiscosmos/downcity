/** LocalCityStore 用户级路径规则。 */

import os from "node:os";
import path from "node:path";

/** 解析 Downcity 用户级数据根目录。 */
export function resolve_local_root_path(input?: string): string {
  const explicit_root = String(input || process.env.DC_PLATFORM_ROOT || "").trim();
  return explicit_root ? path.resolve(explicit_root) : path.join(os.homedir(), ".downcity");
}

/** 返回统一 SQLite 数据库路径。 */
export function get_local_database_path(root_path: string): string {
  return path.join(root_path, "downcity.db");
}

/** 返回统一配置加密密钥路径。 */
export function get_local_key_path(root_path: string): string {
  return path.join(root_path, "main", "model-db.key");
}

/** 返回全局环境变量文件路径。 */
export function get_local_env_path(root_path: string): string {
  return path.join(root_path, ".env");
}

/** 返回第三方 Plugin 制品目录。 */
export function get_local_plugins_path(root_path: string): string {
  return path.join(root_path, "plugins");
}
