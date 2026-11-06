/** CLI 宿主资源服务装配，复用当前 City/Repository；不拥有宿主启动或停止权限。 */
import { ResourceService, ResourceCoordinator, ResourceError, GroupRepository } from "@downcity/city/local";
import { read_power_agent_references } from "@downcity/powers";
import type { City } from "@downcity/city";
import type { CliLocalData } from "../runtime/LocalData.js";
import { create_cli_agent, create_cli_workspace, resolve_cli_agent_model } from "../runtime/AgentAssembly.js";

/** 将产品装配能力注入共用用例，门禁由宿主懒解析同时使用。 */
export function create_cli_resources(data: CliLocalData, city: City, coordinator: ResourceCoordinator): ResourceService {
  return new ResourceService({ root_path: data.root_path, agents: data.agents, workspaces: data.workspaces, coordinator, immutable: false,
    agent_references: async (agent_id) => [
      ...new GroupRepository(data.database).list().filter((group) => group.member_agent_ids.includes(agent_id)).map((group) => ({ kind: "group", group_id: group.group_id })),
      ...data.city_tokens.list().filter((token) => token.agent_ids.includes(agent_id)).map((token) => ({ kind: "city_token", token_id: token.token_id })),
      ...await read_power_agent_references(data.root_path, agent_id),
    ],
    host: {
      city,
      create_agent: async (config) => await create_cli_agent({ config, root_path: data.root_path }),
      resolve_model: async (model_id) => model_id ? await resolve_cli_agent_model(model_id, Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))) : undefined,
      resolve_workspace: async (config) => {
        coordinator.assert_available(undefined, config.workspace_id);
        const existing = city.workspaces.get(config.workspace_id);
        if (existing) return existing;
        const workspace = await create_cli_workspace(config, data.root_path);
        city.workspaces.add(workspace);
        return workspace;
      },
      assert_workspace_idle: async (workspace_id) => {
        const shell = city.workspaces.get(workspace_id)?.shell;
        if (shell && (!shell.has_active_sessions || shell.has_active_sessions())) throw new ResourceError("resource_busy", "Workspace has active Shell processes or does not expose process status", 4);
      },
      release_agent: async () => {},
      invalidate: () => {},
    },
  });
}
