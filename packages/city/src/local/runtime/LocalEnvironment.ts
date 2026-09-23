/**
 * 本地 Agent 环境解析。
 *
 * 平台全局 `.env`、Workspace `.env` 与调用方显式环境在这里按固定优先级合并。
 * Federation 身份和 Agent 会话变量不会从平台 `.env` 注入 Workspace。
 * `HOME` 由这里自动补上：它是 OS 事实，工具链（npm、git、shell）依赖它定位用户目录，
 * 而沙箱子进程拿不到父进程的 `HOME`。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load_project_dotenv } from "@/workspace/index.js";
import dotenv from "dotenv";
import { get_local_env_path } from "@/local/runtime/LocalPaths.js";

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
  /** 调用方显式环境；传入空对象即可禁止进程环境进入 Workspace。 */
  process_env?: NodeJS.ProcessEnv;
  /**
   * 子进程应使用的用户目录；省略时不注入 `HOME`。
   *
   * 说明（中文）
   * - 沙箱子进程拿不到父进程的 `HOME`，而 npm、git 等工具链依赖它，因此宿主需显式传入。
   * - 优先级最低：平台 `.env` 里的 `HOME` 可以覆盖它。
   */
  home_path?: string;
}): Record<string, string> {
  const home_path = String(input.home_path || "").trim();
  return {
    ...(home_path ? { HOME: home_path } : {}),
    ...read_local_global_env(input.root_path),
    ...load_project_dotenv(path.resolve(input.workspace_path)),
    ...read_explicit_env(input.process_env ?? process.env),
  };
}

/** 读取平台全局 Env，供 City 宿主级配置使用。 */
export function resolve_local_global_env(root_path: string): Record<string, string> {
  return read_local_global_env(root_path);
}

/** 把 Node 进程环境收窄为可传给 Workspace 的字符串映射。 */
function read_explicit_env(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
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
