/**
 * CityPaths：用户级平台路径规则。
 *
 * 关键点（中文）
 * - Downcity 的用户级根目录固定在 `~/.downcity/`，测试可用 `DC_PLATFORM_ROOT` 覆盖。
 * - `downcity.db` 保存 City 本地加密状态。
 * - `federation.db` 保存 downfed / Federation 管理端加密状态。
 * - Agent 项目列表等全局索引进入数据库，不再写 `main/agents.json`。
 */

import os from "node:os";
import path from "node:path";

/**
 * 全局根目录（用户级）。
 *
 * 关键点（中文）
 * - 测试或多实例隔离场景可通过 `DC_PLATFORM_ROOT` 显式覆盖。
 */
export function getPlatformRootDirPath(): string {
  const explicitRoot = String(process.env.DC_PLATFORM_ROOT || "").trim();
  if (explicitRoot) return path.resolve(explicitRoot);
  return path.join(os.homedir(), ".downcity");
}

/**
 * 全局 SQLite 数据库路径（用户级）。
 */
export function getPlatformStoreDbPath(): string {
  return path.join(getPlatformRootDirPath(), "downcity.db");
}

/**
 * 全部 Agent 的全局运行状态根目录。
 *
 * 关键点（中文）：运行状态属于受管 Agent，不属于 Workspace，因此不能写入项目目录。
 */
export function get_agent_runtimes_dir_path(): string {
  return path.join(getPlatformRootDirPath(), "runtimes");
}

/** 全局安装的第三方 Plugin 制品目录。 */
export function get_installed_plugins_dir_path(): string {
  return path.join(getPlatformRootDirPath(), "plugins");
}

/**
 * 单个全局 Plugin 的安装目录。
 *
 * @param plugin_name Plugin 稳定名称。
 */
export function get_installed_plugin_dir_path(plugin_name: string): string {
  const normalized_plugin_name = String(plugin_name || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(normalized_plugin_name)) {
    throw new Error(`Invalid plugin name: ${plugin_name}`);
  }
  return path.join(get_installed_plugins_dir_path(), normalized_plugin_name);
}

/**
 * 单个 Agent 的全局运行状态目录。
 *
 * @param agent_id 受管 Agent 的稳定全局 ID。
 */
export function get_agent_runtime_dir_path(agent_id: string): string {
  const normalized_agent_id = String(agent_id || "").trim();
  if (!normalized_agent_id) throw new Error("agent_id is required");
  if (!/^[a-z0-9_]+$/u.test(normalized_agent_id)) {
    throw new Error(`Invalid agent_id: ${normalized_agent_id}`);
  }
  return path.join(get_agent_runtimes_dir_path(), normalized_agent_id);
}

/**
 * Federation 管理端 SQLite 数据库路径（用户级）。
 */
export function getFederationStoreDbPath(): string {
  return path.join(getPlatformRootDirPath(), "federation.db");
}

/**
 * City 全局运行目录（平台密钥 / 旧运行态文件）。
 */
export function getCityRuntimeDirPath(): string {
  return path.join(getPlatformRootDirPath(), "main");
}

/**
 * 全局加密存储密钥文件路径。
 */
export function getPlatformStoreKeyPath(): string {
  return path.join(getCityRuntimeDirPath(), "model-db.key");
}
