/**
 * CityPaths：用户级平台路径规则。
 *
 * 关键点（中文）
 * - Downcity 的用户级根目录固定在 `~/.downcity/`，测试可用 `DC_PLATFORM_ROOT` 覆盖。
 * - `downcity.db` 是 CLI 与 Desktop 全部持久化配置的唯一事实源。
 * - `federation.db` 只作为历史管理端配置迁移源，不再承载运行时写入。
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
 * 平台全局环境变量文件路径。
 *
 * 关键点（中文）：全局 Env 是所有 Workspace 的默认值，使用普通 `.env` 文件保存，便于用户直接维护。
 */
export function get_platform_env_file_path(): string {
  return path.join(getPlatformRootDirPath(), ".env");
}

/**
 * 全部 Agent 的全局运行状态根目录。
 *
 * 关键点（中文）：运行状态属于受管 Agent，不属于 Workspace，因此不能写入项目目录。
 */
export function get_agent_runtimes_dir_path(): string {
  return path.join(getPlatformRootDirPath(), "runtimes");
}

/** CLI City daemon 的唯一运行状态目录。 */
export function get_city_daemon_runtime_dir_path(): string {
  return path.join(get_agent_runtimes_dir_path(), "city");
}

/** 全局安装的第三方 Plugin 制品目录。 */
export function get_plugin_installations_dir_path(): string {
  return path.join(getPlatformRootDirPath(), "plugins");
}

/**
 * 单个内部 Plugin installation 的制品目录。
 *
 * @param installation_id 内部安装记录 ID。
 */
export function get_plugin_installation_dir_path(installation_id: string): string {
  const normalized_installation_id = String(installation_id || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(normalized_installation_id)) {
    throw new Error(`Invalid Plugin installation id: ${installation_id}`);
  }
  return path.join(get_plugin_installations_dir_path(), normalized_installation_id);
}

/**
 * 旧 Federation 管理端 SQLite 数据库路径（用户级）。
 *
 * 关键点（中文）：该路径只用于一次性迁移历史配置，新配置统一写入 `downcity.db`。
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
