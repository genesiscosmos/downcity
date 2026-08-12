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
import { create_downcity_platform_store } from "@/city/runtime/store/index.js";

const agent_start_key_prefix = "cli.agent_start:";

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
  const start = read_agent_start(config.agent_id);
  return {
    agent_id: config.agent_id,
    ...(config.workspace_id ? { workspace_id: config.workspace_id } : {}),
    version: config.version,
    ...(start ? { start } : {}),
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
    if (input.start) write_agent_start(config.agent_id, input.start);
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
    if (input.start !== undefined) write_agent_start(input.agent_id, input.start);
    return { ...saved, ...(input.start !== undefined ? { start: input.start } : {}) };
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
    if (input.start) write_agent_start(input.agent_id, input.start);
    return { ...saved, ...(input.start ? { start: input.start } : {}) };
  });
}

/** 删除 Agent 及其关联配置。 */
export function remove_managed_agent(agent_id: string): void {
  with_local_store((store) => store.remove_agent_config(agent_id));
  const platform_store = create_downcity_platform_store();
  try {
    platform_store.removeSecureSetting(`${agent_start_key_prefix}${agent_id}`);
  } finally {
    platform_store.close();
  }
}

/** 读取 CLI 自己持有的 Agent HTTP 启动配置。 */
function read_agent_start(agent_id: string): ManagedAgent["start"] | undefined {
  const store = create_downcity_platform_store();
  try {
    return store.getSecureSettingJsonSync<ManagedAgent["start"]>(
      `${agent_start_key_prefix}${agent_id}`,
    ) ?? undefined;
  } finally {
    store.close();
  }
}

/** 写入 CLI 自己持有的 Agent HTTP 启动配置。 */
function write_agent_start(agent_id: string, start: NonNullable<ManagedAgent["start"]>): void {
  const store = create_downcity_platform_store();
  try {
    store.setSecureSettingJsonSync(`${agent_start_key_prefix}${agent_id}`, start);
  } finally {
    store.close();
  }
}
