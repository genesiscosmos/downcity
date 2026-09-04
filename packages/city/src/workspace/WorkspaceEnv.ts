/**
 * Workspace 环境变量装配模块。
 *
 * 关键点（中文）
 * - 只读取当前 Workspace 根目录的 `.env`，不读取全局配置文件。
 * - 合并优先级固定为：项目 `.env` < 宿主显式 env。
 * - 返回独立快照，不修改 `process.env`。
 */

import dotenv from "dotenv";
import fs from "fs-extra";
import path from "node:path";

/** 读取 Workspace 根目录的 `.env` 快照。 */
export function load_project_dotenv(
  workspace_path: string,
): Record<string, string> {
  const project_env_path = path.join(workspace_path, ".env");
  if (!fs.existsSync(project_env_path)) return {};

  try {
    const parsed = dotenv.parse(fs.readFileSync(project_env_path, "utf-8"));
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalized_key = String(key || "").trim();
      if (!normalized_key) continue;
      result[normalized_key] = String(value || "").trim();
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 解析 Workspace 最终环境变量。
 *
 * 关键点（中文）
 * - 显式 env 的优先级高于项目 `.env`，符合构造参数覆盖项目默认值的语义。
 * - `undefined` 字段不会进入最终快照。
 */
export function resolve_workspace_env(
  workspace_path: string,
  explicit_env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
  const normalized_explicit_env: Record<string, string> = {};
  for (const [key, value] of Object.entries(explicit_env || {})) {
    if (typeof value === "string") normalized_explicit_env[key] = value;
  }
  return {
    ...load_project_dotenv(workspace_path),
    ...normalized_explicit_env,
  };
}
