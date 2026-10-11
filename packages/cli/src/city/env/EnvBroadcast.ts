/**
 * City Env 运行时广播模块。
 *
 * 持久化完成后只通知当前 City runtime 持有的 Agent 重新加载 Env。
 */

import path from "node:path";
import { list_agent_configs } from "@/city/process/registry/AgentConfigRepository.js";
import { get_workspace_by_path, list_workspaces } from "@/city/process/registry/WorkspaceRepository.js";
import { read_daemon_meta } from "@/city/process/daemon/Manager.js";
import { reload_running_agent_env } from "@/city/process/daemon/DaemonRpcClient.js";
import type { EnvBroadcastResult } from "@/city/types/env/EnvBroadcast.js";

/** 广播 Global Env 变化到当前 City runtime 持有的全部 Agent。 */
export async function broadcast_global_env_reload(): Promise<EnvBroadcastResult> {
  const targets = list_agent_configs().flatMap((agent) =>
    list_workspaces().map((workspace) => ({
      agent_id: agent.agent_id,
      workspace_id: workspace.workspace_id,
    }))
  );
  return await broadcast_agents(targets);
}

/** 广播 Workspace Env 变化到当前正在该 Workspace 运行的 Agent。 */
export async function broadcast_workspace_env_reload(
  workspace_path: string,
): Promise<EnvBroadcastResult> {
  const normalized_path = path.resolve(workspace_path);
  const running_targets: Array<{ agent_id: string; workspace_id: string }> = [];
  const meta = await read_daemon_meta();
  const workspace = get_workspace_by_path(normalized_path);
  if (!workspace) return await broadcast_agents([]);
  for (const agent of list_agent_configs()) {
    if (!meta?.agent_ids.includes(agent.agent_id)) continue;
    running_targets.push({ agent_id: agent.agent_id, workspace_id: workspace.workspace_id });
  }
  return await broadcast_agents(running_targets);
}

/** 并行通知一组 Agent，并保留每个目标的明确结果。 */
async function broadcast_agents(
  targets: Array<{ agent_id: string; workspace_id: string }>,
): Promise<EnvBroadcastResult> {
  const result: EnvBroadcastResult = {
    updated_agent_ids: [],
    failed_agents: [],
  };
  const unique_targets = new Map(
    targets.map((target) => [`${target.agent_id}/${target.workspace_id}`, target]),
  );
  await Promise.all([...unique_targets.values()].map(async ({ agent_id, workspace_id }) => {
    try {
      const updated = await reload_running_agent_env(agent_id, workspace_id);
      if (updated) result.updated_agent_ids.push(agent_id);
    } catch (error) {
      result.failed_agents.push({
        agent_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
  result.updated_agent_ids.sort();
  result.failed_agents.sort((left, right) => left.agent_id.localeCompare(right.agent_id));
  return result;
}
