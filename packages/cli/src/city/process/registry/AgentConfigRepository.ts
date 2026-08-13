/**
 * CLI Agent 配置适配层。
 *
 * 本模块通过 Local AgentRepository 读写配置，只投影 CLI 控制面类型。
 */

import type { LocalAgentConfig } from "@downcity/local/product";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import type { JsonObject } from "@downcity/agent";
import type {
  CreateAgentConfigInput,
  AgentConfig,
  UpdateAgentConfigInput,
} from "@/city/types/agent/AgentConfig.js";

/** 把 Local Store 管理视图投影为 CLI 类型。 */
function to_agent_config(config: LocalAgentConfig): AgentConfig {
  return {
    agent_id: config.agent_id,
    workspace_id: config.workspace_id,
    version: config.version,
    ...(config.execution ? { execution: config.execution as unknown as AgentConfig["execution"] } : {}),
    ...(config.llm ? { llm: config.llm as unknown as AgentConfig["llm"] } : {}),
    created_at: config.created_at,
    updated_at: config.updated_at,
  };
}

/** 按 ID 读取 Agent。 */
export function get_agent_config(agent_id: string): AgentConfig | null {
  return with_cli_local_data((data) => {
    const config = data.agents.get(agent_id);
    return config ? to_agent_config(config) : null;
  });
}

/** 列出全部 Agent。 */
export function list_agent_configs(): AgentConfig[] {
  return with_cli_local_data((data) => data.agents.list().map(to_agent_config));
}

/** 创建已绑定 Workspace 的 Agent 配置。 */
export function create_agent_config(input: CreateAgentConfigInput): AgentConfig {
  return with_cli_local_data((data) => {
    const config = data.agents.create({
      agent_id: input.agent_id,
      workspace_id: input.workspace_id,
      version: input.version,
      execution: input.execution as unknown as JsonObject | undefined,
      llm: input.llm as unknown as JsonObject | undefined,
    });
    return to_agent_config(config);
  });
}

/** 更新 Agent 配置。 */
export function update_agent_config(input: UpdateAgentConfigInput): AgentConfig {
  return with_cli_local_data((data) => {
    const current = data.agents.get(input.agent_id);
    if (!current) throw new Error(`Agent not found: ${input.agent_id}`);
    const saved = to_agent_config(data.agents.save({
      ...current,
      ...(input.execution !== undefined
        ? { execution: input.execution as unknown as JsonObject }
        : {}),
      ...(input.llm !== undefined ? { llm: input.llm as unknown as JsonObject } : {}),
    }));
    return saved;
  });
}

/** 保存完整 Agent 配置。 */
export function save_agent_config(input: AgentConfig): AgentConfig {
  return with_cli_local_data((data) => {
    const previous = data.agents.get(input.agent_id);
    const saved = to_agent_config(data.agents.save({
      agent_id: input.agent_id,
      workspace_id: input.workspace_id,
      version: input.version,
      ...(input.execution ? { execution: input.execution as unknown as JsonObject } : {}),
      ...(input.llm ? { llm: input.llm as unknown as JsonObject } : {}),
      plugins: previous?.plugins ?? [],
      created_at: previous?.created_at ?? input.created_at,
      updated_at: input.updated_at,
    }));
    return saved;
  });
}

/** 删除 Agent 及其关联配置。 */
export function remove_agent_config(agent_id: string): void {
  with_cli_local_data((data) => {
    data.agent_tokens.remove_all(agent_id);
    data.agents.remove(agent_id);
  });
}
