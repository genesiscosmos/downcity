/**
 * Agent 项目环境变量装配模块。
 *
 * 关键点（中文）
 * - 只读取当前项目根目录的 `.env`，不读取任何全局配置文件。
 * - 合并优先级固定为：宿主环境 < 项目 `.env`。
 * - 返回独立快照，不修改 `process.env`。
 */
import dotenv from "dotenv";
import fs from "fs-extra";
import path from "node:path";

/**
 * 读取项目 `.env` 快照。
 */
export function load_project_dotenv(project_root: string): Record<string, string> {
  const project_env_path = path.join(project_root, ".env");
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
 * 解析 Agent 最终环境变量。
 */
export function resolve_agent_env(
  project_root: string,
  host_env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
  const normalized_host_env: Record<string, string> = {};
  for (const [key, value] of Object.entries(host_env || {})) {
    if (typeof value === "string") normalized_host_env[key] = value;
  }
  return {
    ...normalized_host_env,
    ...load_project_dotenv(project_root),
  };
}
