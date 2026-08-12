/**
 * Downcity 平台 native Agent 装配入口。
 *
 * CLI daemon 与 Electron main 都通过本入口消费同一份 Agent、Workspace、Plugin、
 * Embassy 和 Sandbox 配置。Transport 与进程生命周期仍由各自宿主拥有。
 */

import path from "node:path";
import { create_city_agent } from "@downcity/agent";
import { resolve_managed_agent_env } from "@/city/env/ProcessEnv.js";
import { get_managed_agent } from "@/city/process/registry/ManagedAgentRepository.js";
import { get_workspace_by_path } from "@/city/process/registry/WorkspaceRepository.js";
import { list_agent_plugin_bindings } from "@/city/process/registry/PluginRepository.js";
import { createRuntimeModel } from "@/city/runtime/city-model/CreateRuntimeModel.js";
import { createCityAiAgentModel } from "@/city/runtime/city-model/CityAiServiceBinding.js";
import { assemble_plugins } from "@/city/runtime/plugins/PluginAssembler.js";
import { create_platform_sandbox } from "@/city/sandbox/PlatformSandbox.js";
import type {
  CreatePlatformAgentInput,
  PlatformAgentRuntime,
} from "./types.js";

export type {
  CreatePlatformAgentInput,
  PlatformAgentRuntime,
} from "./types.js";

/** 从共享持久化配置创建并等待一个 native Agent 就绪。 */
export async function create_platform_agent(
  input: CreatePlatformAgentInput,
): Promise<PlatformAgentRuntime> {
  const agent_id = String(input.agent_id || "").trim();
  const workspace_path_input = String(input.workspace_path || "").trim();
  if (!agent_id) throw new Error("agent_id is required");
  if (!workspace_path_input) throw new Error("workspace_path is required");
  const workspace_path = path.resolve(workspace_path_input);
  const config = get_managed_agent(agent_id);
  const workspace_record = get_workspace_by_path(workspace_path);
  if (!config) throw new Error(`Agent not registered: ${agent_id}`);
  if (!workspace_record) throw new Error(`Workspace not registered: ${workspace_path}`);

  const env = resolve_managed_agent_env(workspace_path);
  const plugin_bindings = list_agent_plugin_bindings(agent_id);
  const [model, plugins, sandbox] = await Promise.all([
    createRuntimeModel({ config, env }),
    assemble_plugins({
      bindings: plugin_bindings,
      context: {
        env,
        ...(input.host ? { host: input.host } : {}),
        ...(input.port !== undefined ? { port: input.port } : {}),
      },
    }),
    create_platform_sandbox(),
  ]);
  const agent = create_city_agent({
    agent_id,
    workspace_path,
    model,
    plugins,
    sandbox,
    env,
  });
  try {
    await agent.ready();
  } catch (error) {
    await agent.dispose();
    throw error;
  }
  return {
    agent,
    workspace_path,
    create_session_model: async (model_id) => await createCityAiAgentModel({
      modelId: model_id,
      env,
    }),
    reload_workspace_env: () => {
      const next_env = resolve_managed_agent_env(workspace_path);
      agent.workspace.set_env(next_env);
      return next_env;
    },
  };
}
