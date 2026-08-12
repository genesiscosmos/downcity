/**
 * 平台全局环境变量读取与合并模块。
 *
 * 职责说明（中文）
 * - 从 `~/.downcity/.env` 读取 global env。
 * - 为 City 宿主提供显式 env 合并能力，避免让 `@downcity/agent` 直接依赖 `process.env`。
 *
 * 边界说明（中文）
 * - 这里只处理 global env，不处理项目 `.env`。
 * - 不负责 session 级运行时元信息（例如 `DC_SESSION_ID`）。
 */

import path from "node:path";
import { load_project_dotenv } from "@downcity/agent";
import { get_platform_env_file_path } from "@/city/process/registry/CityPaths.js";
import { read_env_file_sync } from "@/city/env/EnvFileStore.js";

const PLATFORM_SESSION_ENV_KEYS = new Set([
  "DC_AUTH_TOKEN",
  "DC_AGENT_TOKEN",
  "DOWNCITY_FEDERATION_URL",
  "DOWNCITY_USER_TOKEN",
  // 旧身份变量已停止解析，但仍禁止从全局 `.env` 泄漏到 Workspace 进程。
  "DOWNCITY_CITY_URL",
  "DOWNCITY_CITY_USER_TOKEN",
  "CITY_URL",
  "CITY_USER_TOKEN",
]);

/**
 * 读取平台 global env 映射。
 */
export function read_platform_global_env(): Record<string, string> {
  return read_env_file_sync(get_platform_env_file_path());
}

/**
 * 移除不允许由平台 global env 注入的会话/身份变量。
 */
export function strip_platform_session_env(
  env: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (PLATFORM_SESSION_ENV_KEYS.has(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

/**
 * 合并平台 global env 到目标环境变量映射。
 *
 * 关键点（中文）
 * - 平台 global env 视为运行配置，只补充当前进程缺失的变量。
 * - 平台 global env 不能覆盖当前 CLI 登录态、本机控制 token 或 admin secret。
 * - 显式 shell env 仍保留最高优先级，便于脚本化调试。
 * - 返回新对象，不直接修改传入参数。
 */
export function merge_process_env_with_platform_global_env(
  base_env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(base_env)) {
    if (typeof value === "string") merged[key] = value;
  }
  const platform_env = strip_platform_session_env(read_platform_global_env());
  return {
    ...platform_env,
    ...merged,
  };
}

/**
 * 解析受管 Agent 的最终 Env 快照。
 *
 * 优先级固定为：Global `.env` < Workspace `.env` < daemon 进程显式 Env。
 */
export function resolve_managed_agent_env(
  workspace_path: string,
  process_env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const normalized_workspace_path = path.resolve(workspace_path);
  const explicit_env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process_env)) {
    if (typeof value === "string") explicit_env[key] = value;
  }
  return {
    ...strip_platform_session_env(read_platform_global_env()),
    ...load_project_dotenv(normalized_workspace_path),
    ...explicit_env,
  };
}
