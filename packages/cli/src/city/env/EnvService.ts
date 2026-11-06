/**
 * City Env 应用服务。
 *
 * 统一完成目标解析、文件持久化与运行中 Agent 广播，供脚本命令和 TUI 共用。
 */

import path from "node:path";
import { ResourceClient } from "../resources/ResourceClient.js";
import { get_platform_env_file_path } from "@/city/process/registry/CityPaths.js";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import {
  normalize_env_key,
  read_env_file,
} from "@/city/env/EnvFileStore.js";
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
  const result = await new ResourceClient().call("config.env.set", { ...await coordinated_target(target), key, value });
  const applied = result.data as Pick<EnvMutationResult, "changed" | "broadcast">;
  return {
    target,
    key,
    changed: applied.changed,
    broadcast: applied.broadcast,
  };
}

/** 删除目标 Env key，并在真实修改后广播运行时重载。 */
export async function delete_env_target_value(
  target: EnvTarget,
  key_input: string,
): Promise<EnvMutationResult> {
  const key = normalize_env_key(key_input);
  const result = await new ResourceClient().call("config.env.delete", { ...await coordinated_target(target), key });
  const applied = result.data as Pick<EnvMutationResult, "changed" | "broadcast">;
  const changed = applied.changed;
  return {
    target,
    key,
    changed,
    broadcast: applied.broadcast,
  };
}

/** 只把稳定 Workspace ID 交给宿主，不接受任意文件写入路径。 */
async function coordinated_target(target: EnvTarget): Promise<Record<string, unknown>> {
  if (target.scope === "global") return {};
  const result = await new ResourceClient().call("workspace.list");
  const items = (result.data as import("../resources/ResourceResults.js").WorkspaceListData).items;
  const workspace = items.find((item) => item.workspace_path === target.workspace_path && item.registered);
  if (!workspace) throw new Error("Env Workspace is no longer registered");
  return { workspace_id: workspace.workspace_id };
}
