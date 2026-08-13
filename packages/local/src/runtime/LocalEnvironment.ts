/**
 * 本地 Agent 环境解析。
 *
 * 平台全局 `.env`、Workspace `.env` 与宿主进程环境在这里按固定优先级合并。
 * Federation 身份和 Agent 会话变量不会从平台 `.env` 注入 Workspace。
 */

import fs from "node:fs";
import path from "node:path";
import { load_project_dotenv } from "@downcity/agent";
import dotenv from "dotenv";
import { get_local_env_path } from "@/runtime/LocalPaths.js";

const protected_env_keys = new Set([
  "DC_AUTH_TOKEN",
  "DC_AGENT_TOKEN",
  "DOWNCITY_FEDERATION_URL",
  "DOWNCITY_USER_TOKEN",
  "DOWNCITY_CITY_URL",
  "DOWNCITY_CITY_USER_TOKEN",
  "CITY_URL",
  "CITY_USER_TOKEN",
]);

/** 解析一个 Agent 的最终 Workspace 环境快照。 */
export function resolve_local_agent_env(input: {
  /** Downcity 用户级数据根目录。 */
  root_path: string;
  /** 当前 Agent 对应的 Workspace 目录。 */
  workspace_path: string;
  /** 当前宿主进程显式环境。 */
  process_env?: NodeJS.ProcessEnv;
}): Record<string, string> {
  return {
    ...read_local_global_env(input.root_path),
    ...load_project_dotenv(path.resolve(input.workspace_path)),
    ...read_explicit_env(input.process_env ?? process.env),
  };
}

/** 读取平台 `.env`，并移除只能由当前宿主显式提供的身份变量。 */
function read_local_global_env(root_path: string): Record<string, string> {
  const env_path = get_local_env_path(root_path);
  if (!fs.existsSync(env_path)) return {};
  const parsed = dotenv.parse(fs.readFileSync(env_path, "utf8"));
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!protected_env_keys.has(key)) result[key] = value;
  }
  return result;
}

/** 把 Node 进程环境收窄为可传给 Workspace 的字符串映射。 */
function read_explicit_env(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
