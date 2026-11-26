/** City 领域能力的唯一 Power 投影；当前对象和目录对象共用句柄，脚本通过同一来源调用。 */
import type { CityRuntimeAccess } from "../types/CityRuntimeAccess.js";
import type { PowerAgentHandle, PowerCityHandle, PowerWorkspaceHandle } from "@/power/types/PowerContext.js";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import { create_power_session_collection } from "./PowerSessionBridge.js";

/** 当前调用可见的 City 目录；不包含容器生命周期、配置写入或原始内部实例。 */
export function create_power_city_directory(input: {
  /** City 领域事实源，调用时重新读取以遵守删除与替换门禁。 */
  readonly access: Pick<CityRuntimeAccess, "get_agent" | "list_agents" | "list_workspaces">;
  /** 当前调用绑定的 Workspace，只用于创建与恢复已有 Session 资源。 */
  readonly workspace?: WorkspaceRuntime;
  /** 当前 Power 的已登记执行约束所有权校验。 */
  readonly assert_execution_profile?: (id: string, version: number) => void;
}): Pick<PowerCityHandle, "agents" | "workspaces"> {
  const agent_handles = new Map<string, PowerAgentHandle>();
  const workspace_handles = new Map<string, PowerWorkspaceHandle>();
  const require_agent = (agent_id: string) => {
    const agent = input.access.get_agent(agent_id);
    if (!agent) throw new Error(`host_unavailable: Agent is unavailable: ${agent_id}`);
    return agent;
  };
  const require_workspace = (workspace_id: string) => {
    const workspace = input.access.list_workspaces().find(item => item.id === workspace_id);
    if (!workspace) throw new Error(`host_unavailable: Workspace is unavailable: ${workspace_id}`);
    return workspace;
  };
  const bind_agent = (agent_id: string): PowerAgentHandle => {
    let handle = agent_handles.get(agent_id);
    if (!handle) {
      handle = Object.freeze({
        id: agent_id,
        get name() { return require_agent(agent_id).name; },
        get role() { return require_agent(agent_id).role; },
        get description() { return require_agent(agent_id).description; },
        get model() {
          const model = require_agent(agent_id).model;
          return model ? Object.freeze({ id: model.id, reference: model.model_reference ?? null }) : null;
        },
        get instructions() { return require_agent(agent_id).get_instructions(); },
        get work() { return require_agent(agent_id).get_session_work(); },
        sessions: create_power_session_collection({ get_sessions: () => require_agent(agent_id).sessions, workspace: input.workspace, assert_execution_profile: input.assert_execution_profile }),
      });
      agent_handles.set(agent_id, handle);
    }
    return handle;
  };
  const bind_workspace = (workspace_id: string): PowerWorkspaceHandle => {
    let handle = workspace_handles.get(workspace_id);
    if (!handle) {
      handle = Object.freeze({
        id: workspace_id,
        get name() { return require_workspace(workspace_id).name || workspace_id; },
        get path() { return require_workspace(workspace_id).path; },
        get shell() { return require_workspace(workspace_id).shell; },
        get env() { return require_workspace(workspace_id).get_env(); },
      });
      workspace_handles.set(workspace_id, handle);
    }
    return handle;
  };
  return Object.freeze({
    agents: Object.freeze({
      get: (agent_id: string) => input.access.get_agent(agent_id) ? bind_agent(agent_id) : null,
      list: () => input.access.list_agents().map(agent => bind_agent(agent.id)),
    }),
    workspaces: Object.freeze({
      get: (workspace_id: string) => input.access.list_workspaces().some(item => item.id === workspace_id) ? bind_workspace(workspace_id) : null,
      list: () => input.access.list_workspaces().map(workspace => bind_workspace(workspace.id)),
    }),
  });
}
