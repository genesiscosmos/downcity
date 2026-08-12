/**
 * City Env 运行时广播模块。
 *
 * 持久化完成后通知受影响的运行中 Agent 重新加载 Env；停止状态不视为失败。
 */

import path from "node:path";
import { list_managed_agents } from "@/city/process/registry/ManagedAgentRepository.js";
import { get_workspace } from "@/city/process/registry/WorkspaceRepository.js";
import { read_daemon_meta } from "@/city/process/daemon/Manager.js";
import { reload_running_agent_env } from "@/city/process/daemon/DaemonRpcClient.js";
import type { EnvBroadcastResult } from "@/city/types/env/EnvBroadcast.js";

/** 广播 Global Env 变化到全部受管 Agent。 */
export async function broadcast_global_env_reload(): Promise<EnvBroadcastResult> {
  return await broadcast_agents(list_managed_agents().map((agent) => agent.agent_id));
}

/** 广播 Workspace Env 变化到当前正在该 Workspace 运行的 Agent。 */
export async function broadcast_workspace_env_reload(
  workspace_path: string,
): Promise<EnvBroadcastResult> {
  const normalized_path = path.resolve(workspace_path);
  const running_agent_ids: string[] = [];
  const meta = await read_daemon_meta();
  for (const agent of list_managed_agents()) {
    if (!meta?.agent_ids.includes(agent.agent_id) || !agent.workspace_id) continue;
    const workspace = get_workspace(agent.workspace_id);
    if (workspace && path.resolve(workspace.workspace_path) === normalized_path) {
      running_agent_ids.push(agent.agent_id);
    }
  }
  return await broadcast_agents(running_agent_ids);
}

/** 并行通知一组 Agent，并保留每个目标的明确结果。 */
async function broadcast_agents(agent_ids: string[]): Promise<EnvBroadcastResult> {
  const result: EnvBroadcastResult = {
    updated_agent_ids: [],
    stopped_agent_ids: [],
    failed_agents: [],
  };
  await Promise.all([...new Set(agent_ids)].map(async (agent_id) => {
    try {
      const updated = await reload_running_agent_env(agent_id);
      (updated ? result.updated_agent_ids : result.stopped_agent_ids).push(agent_id);
    } catch (error) {
      result.failed_agents.push({
        agent_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
  result.updated_agent_ids.sort();
  result.stopped_agent_ids.sort();
  result.failed_agents.sort((left, right) => left.agent_id.localeCompare(right.agent_id));
  return result;
}
