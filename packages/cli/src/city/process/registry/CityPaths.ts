/**
 * CityPaths：用户级平台路径规则。
 *
 * 关键点（中文）
 * - Downcity 的用户级根目录固定在 `~/.downcity/`，测试可用 `DC_PLATFORM_ROOT` 覆盖。
 * - Agent 与 Plugin 配置由 `@downcity/local` 统一解析文件路径。
 * - 当前模块只拥有 CLI City 的环境和运行状态路径。
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
 * 关键点（中文）：这里保存 CLI City 宿主运行状态，不属于 Workspace 或单个 Agent。
 */
export function get_agent_runtimes_dir_path(): string {
  return path.join(getPlatformRootDirPath(), "runtimes");
}

/** CLI City daemon 的唯一运行状态目录。 */
export function get_city_daemon_runtime_dir_path(): string {
  return path.join(get_agent_runtimes_dir_path(), "city");
}
