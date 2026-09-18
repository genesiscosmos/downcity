/** Downcity 本地产品数据路径规则。 */

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

/** 返回全局环境变量文件路径。 */
export function get_local_env_path(root_path: string): string {
  return path.join(root_path, ".env");
}

/** 返回第三方 Power 制品目录。 */
export function get_local_powers_path(root_path: string): string {
  return path.join(root_path, "powers");
}

/** 返回一个 Power 的稳定定义与配置目录。 */
export function get_local_power_path(root_path: string, power_id: string): string {
  return path.join(get_local_powers_path(root_path), power_id);
}

/** 返回全部 Agent 定义的根目录。 */
export function get_local_agents_path(root_path: string): string {
  return path.join(root_path, "agents");
}

/** 返回单个 Agent 的定义目录。 */
export function get_local_agent_path(root_path: string, agent_id: string): string {
  return path.join(get_local_agents_path(root_path), agent_id);
}
