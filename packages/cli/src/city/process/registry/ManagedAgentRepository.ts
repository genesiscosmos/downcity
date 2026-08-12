/**
 * CLI Agent Registry 适配层。
 *
 * 注册规则和持久化由 `@downcity/agent-registry` 唯一拥有；本模块只把共享记录
 * 投影为 CLI 控制面类型。Agent 配置不包含 Workspace。
 */

import {
  create_agent_registry_record,
  get_agent_registry_record,
  list_agent_registry_records,
  normalize_agent_registry_id,
  remove_agent_registry_record,
  save_agent_registry_record,
  update_agent_registry_record,
  type AgentRegistryRecord,
} from "@downcity/agent-registry";
import type {
  CreateManagedAgentInput,
  ManagedAgent,
  UpdateManagedAgentInput,
} from "@/city/types/agent/ManagedAgent.js";

/** 把共享记录投影成 CLI 类型。 */
function to_managed_agent(record: AgentRegistryRecord): ManagedAgent {
  return record as ManagedAgent;
}

/** 规范化 Agent ID。 */
export const normalize_managed_agent_id = normalize_agent_registry_id;

/** 按 ID 读取 Agent。 */
export function get_managed_agent(agent_id: string): ManagedAgent | null {
  const record = get_agent_registry_record(agent_id);
  return record ? to_managed_agent(record) : null;
}

/** 列出全部 Agent。 */
export function list_managed_agents(): ManagedAgent[] {
  return list_agent_registry_records().map(to_managed_agent);
}

/** 创建 Agent。 */
export function create_managed_agent(input: CreateManagedAgentInput): ManagedAgent {
  return to_managed_agent(create_agent_registry_record(
    input as unknown as Parameters<typeof create_agent_registry_record>[0],
  ));
}

/** 更新 Agent。 */
export function update_managed_agent(input: UpdateManagedAgentInput): ManagedAgent {
  return to_managed_agent(update_agent_registry_record(
    input as unknown as Parameters<typeof update_agent_registry_record>[0],
  ));
}

/** 保存完整 Agent。 */
export function save_managed_agent(input: ManagedAgent): ManagedAgent {
  return to_managed_agent(save_agent_registry_record(
    input as unknown as AgentRegistryRecord,
  ));
}

/** 删除 Agent 及其 CLI 关联数据。 */
export function remove_managed_agent(agent_id: string): void {
  remove_agent_registry_record(agent_id);
}
