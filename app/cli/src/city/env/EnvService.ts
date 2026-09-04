/**
 * City Env 应用服务。
 *
 * 统一完成目标解析、文件持久化与运行中 Agent 广播，供脚本命令和 TUI 共用。
 */

import path from "node:path";
import { get_platform_env_file_path } from "@/city/process/registry/CityPaths.js";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import {
  delete_env_file_value,
  normalize_env_key,
  read_env_file,
  set_env_file_value,
} from "@/city/env/EnvFileStore.js";
import {
  broadcast_global_env_reload,
  broadcast_workspace_env_reload,
} from "@/city/env/EnvBroadcast.js";
import type { EnvMutationResult, EnvTarget } from "@/city/types/env/EnvTarget.js";

/** 解析平台 Global Env 目标。 */
export function resolve_global_env_target(): EnvTarget {
  return {
    scope: "global",
    file_path: get_platform_env_file_path(),
    mode: 0o600,
  };
}

/** 通过 Agent ID 解析其 Workspace Env 目标。 */
export async function resolve_agent_env_target(agent_id?: string): Promise<EnvTarget> {
  const target = await resolve_cli_agent_target(agent_id);
  return {
    scope: "workspace",
    agent_id: target.agent_id,
    workspace_path: target.workspace_path,
    file_path: path.join(target.workspace_path, ".env"),
  };
}

/** 读取目标 Env 映射。 */
export async function read_env_target(target: EnvTarget): Promise<Record<string, string>> {
  return await read_env_file(target.file_path);
}

/** 设置目标 Env key，并广播完整运行时重载。 */
export async function set_env_target_value(
  target: EnvTarget,
  key_input: string,
  value: string,
): Promise<EnvMutationResult> {
  const key = normalize_env_key(key_input);
  await set_env_file_value({
    file_path: target.file_path,
    key,
    value,
    mode: target.mode,
  });
  return {
    target,
    key,
    changed: true,
    broadcast: await broadcast_target(target),
  };
}

/** 删除目标 Env key，并在真实修改后广播运行时重载。 */
export async function delete_env_target_value(
  target: EnvTarget,
  key_input: string,
): Promise<EnvMutationResult> {
  const key = normalize_env_key(key_input);
  const changed = await delete_env_file_value({
    file_path: target.file_path,
    key,
    mode: target.mode,
  });
  return {
    target,
    key,
    changed,
    broadcast: changed ? await broadcast_target(target) : empty_broadcast(),
  };
}

/** 按目标作用域通知受影响 Agent。 */
async function broadcast_target(target: EnvTarget) {
  if (target.scope === "global") return await broadcast_global_env_reload();
  if (!target.workspace_path) throw new Error("Workspace Env target is missing workspace_path");
  return await broadcast_workspace_env_reload(target.workspace_path);
}

/** 构造未发生修改时的空广播结果。 */
function empty_broadcast() {
  return {
    updated_agent_ids: [],
    failed_agents: [],
  };
}
