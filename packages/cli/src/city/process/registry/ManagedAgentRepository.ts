/**
 * CLI Agent 配置适配层。
 *
 * 所有配置统一读写 LocalCityStore；本模块只投影 CLI 控制面类型，不拥有数据库 Schema。
 */

import { LocalCityStore, type LocalAgentConfig } from "@downcity/city";
import type { JsonObject } from "@downcity/agent";
import type {
  CreateManagedAgentInput,
  ManagedAgent,
  UpdateManagedAgentInput,
} from "@/city/types/agent/ManagedAgent.js";

/** 在短连接 LocalCityStore 上执行同步配置操作。 */
function with_local_store<T>(action: (store: LocalCityStore) => T): T {
  const store = new LocalCityStore();
  try {
    return action(store);
  } finally {
    store.close();
  }
}

/** 把 Local Store 管理视图投影为 CLI 类型。 */
function to_managed_agent(config: LocalAgentConfig): ManagedAgent {
  return {
    agent_id: config.agent_id,
    ...(config.workspace_id ? { workspace_id: config.workspace_id } : {}),
    version: config.version,
    ...(config.execution ? { execution: config.execution as unknown as ManagedAgent["execution"] } : {}),
    ...(config.llm ? { llm: config.llm as unknown as ManagedAgent["llm"] } : {}),
    created_at: config.created_at,
    updated_at: config.updated_at,
  };
}

/** 规范化 Agent ID。 */
export function normalize_managed_agent_id(input: string): string {
  return String(input || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_{2,}/gu, "_");
}

/** 按 ID 读取 Agent。 */
export function get_managed_agent(agent_id: string): ManagedAgent | null {
  return with_local_store((store) => {
    const config = store.get_agent_config(agent_id);
    return config ? to_managed_agent(config) : null;
  });
}

/** 列出全部 Agent。 */
export function list_managed_agents(): ManagedAgent[] {
  return with_local_store((store) => store.list_agent_configs().map(to_managed_agent));
}

/** 创建已绑定 Workspace 的 Agent 配置。 */
export function create_managed_agent(input: CreateManagedAgentInput): ManagedAgent {
  return with_local_store((store) => {
    const config = store.create_agent_config({
      agent_id: input.agent_id,
      version: input.version,
      execution: input.execution as unknown as JsonObject | undefined,
      llm: input.llm as unknown as JsonObject | undefined,
    });
    store.bind_agent_workspace(config.agent_id, input.workspace_id);
    return to_managed_agent(store.get_agent_config(config.agent_id)!);
  });
}

/** 更新 Agent 配置。 */
export function update_managed_agent(input: UpdateManagedAgentInput): ManagedAgent {
  return with_local_store((store) => {
    const current = store.get_agent_config(input.agent_id);
    if (!current) throw new Error(`Agent not found: ${input.agent_id}`);
    const saved = to_managed_agent(store.save_agent_config({
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
export function save_managed_agent(input: ManagedAgent): ManagedAgent {
  return with_local_store((store) => {
    const previous = store.get_agent_config(input.agent_id);
    const saved = to_managed_agent(store.save_agent_config({
      agent_id: input.agent_id,
      ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
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
export function remove_managed_agent(agent_id: string): void {
  with_local_store((store) => store.remove_agent_config(agent_id));
}
