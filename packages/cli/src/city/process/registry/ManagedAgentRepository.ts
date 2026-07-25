/**
 * ManagedAgentRepository：Downcity 全局 Agent 的唯一配置仓储。
 *
 * 关键点（中文）
 * - Agent 身份、Workspace 绑定、模型与 Plugin 配置只保存在 `managed_agents` 表。
 * - 不再维护独立项目路径 Registry，也不从 Workspace 目录读取 Agent 声明。
 * - 多个 Agent 可以绑定同一个 Workspace，按路径反查时必须显式处理歧义。
 */

import path from "node:path";
import { withPlatformStore } from "@/city/runtime/store/index.js";
import {
  get_managed_agent_row,
  list_managed_agent_rows,
  list_managed_agent_rows_by_workspace,
  remove_managed_agent_row,
  set_managed_agent_row,
} from "@/city/runtime/store/StoreManagedAgentRepository.js";
import type {
  CreateManagedAgentInput,
  ManagedAgent,
  UpdateManagedAgentInput,
} from "@/city/types/agent/ManagedAgent.js";

/** 生成当前 ISO 时间。 */
function now_iso(): string {
  return new Date().toISOString();
}

/** 规范化全局 Agent ID。 */
export function normalize_managed_agent_id(input: string): string {
  const agent_id = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  if (!agent_id) throw new Error("agent_id is required");
  return agent_id;
}

/** 规范化 Workspace 绝对路径。 */
export function normalize_managed_workspace_path(input: string): string {
  const workspace_path = path.resolve(String(input || "").trim() || ".");
  if (!workspace_path) throw new Error("workspace_path is required");
  return workspace_path;
}

/** 按 Agent ID 读取受管 Agent。 */
export function get_managed_agent(agent_id_input: string): ManagedAgent | null {
  const agent_id = normalize_managed_agent_id(agent_id_input);
  return withPlatformStore((context) => get_managed_agent_row(context, agent_id));
}

/** 按 Workspace 路径读取全部受管 Agent。 */
export function list_managed_agents_by_workspace(
  workspace_path_input: string,
): ManagedAgent[] {
  const workspace_path = normalize_managed_workspace_path(workspace_path_input);
  return withPlatformStore((context) =>
    list_managed_agent_rows_by_workspace(context, workspace_path)
  );
}

/**
 * 按 Workspace 路径读取唯一 Agent。
 *
 * 关键点（中文）
 * - 路径不是 Agent 身份，因此允许返回空。
 * - 同一路径绑定多个 Agent 时拒绝猜测，调用方必须使用 `agent_id`。
 */
export function get_managed_agent_by_workspace(
  workspace_path_input: string,
): ManagedAgent | null {
  const agents = list_managed_agents_by_workspace(workspace_path_input);
  if (agents.length <= 1) return agents[0] ?? null;
  throw new Error(
    `Workspace is bound to multiple agents: ${agents.map((agent) => agent.agent_id).join(", ")}`,
  );
}

/** 列出全部受管 Agent。 */
export function list_managed_agents(): ManagedAgent[] {
  return withPlatformStore((context) => list_managed_agent_rows(context));
}

/** 创建新的受管 Agent，并拒绝重复 ID。 */
export function create_managed_agent(
  input: CreateManagedAgentInput,
): ManagedAgent {
  const agent_id = normalize_managed_agent_id(input.agent_id);
  const workspace_path = normalize_managed_workspace_path(input.workspace_path);
  return withPlatformStore((context) => {
    if (get_managed_agent_row(context, agent_id)) {
      throw new Error(`Agent already exists: ${agent_id}`);
    }
    const current_time = now_iso();
    const agent: ManagedAgent = {
      agent_id,
      workspace_path,
      version: String(input.version || "").trim() || "1.0.0",
      ...(input.start ? { start: input.start } : {}),
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.plugins ? { plugins: input.plugins } : {}),
      ...(input.llm ? { llm: input.llm } : {}),
      created_at: current_time,
      updated_at: current_time,
    };
    set_managed_agent_row(context, agent);
    return agent;
  });
}

/** 更新现有受管 Agent。 */
export function update_managed_agent(
  input: UpdateManagedAgentInput,
): ManagedAgent {
  const agent_id = normalize_managed_agent_id(input.agent_id);
  return withPlatformStore((context) => {
    const existing = get_managed_agent_row(context, agent_id);
    if (!existing) throw new Error(`Agent not found: ${agent_id}`);
    const updates_workspace = Object.prototype.hasOwnProperty.call(
      input,
      "workspace_path",
    );
    if (updates_workspace && input.workspace_path === undefined) {
      throw new Error("workspace_path cannot be undefined");
    }
    const agent: ManagedAgent = {
      ...existing,
      ...(updates_workspace
        ? { workspace_path: normalize_managed_workspace_path(input.workspace_path as string) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "start")
        ? { start: input.start }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "execution")
        ? { execution: input.execution }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "plugins")
        ? { plugins: input.plugins }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "llm")
        ? { llm: input.llm }
        : {}),
      updated_at: now_iso(),
    };
    set_managed_agent_row(context, agent);
    return agent;
  });
}

/** 保存一份完整受管 Agent 配置。 */
export function save_managed_agent(input: ManagedAgent): ManagedAgent {
  const agent_id = normalize_managed_agent_id(input.agent_id);
  const workspace_path = normalize_managed_workspace_path(input.workspace_path);
  return withPlatformStore((context) => {
    const existing = get_managed_agent_row(context, agent_id);
    if (!existing) throw new Error(`Agent not found: ${agent_id}`);
    const agent: ManagedAgent = {
      ...input,
      agent_id,
      workspace_path,
      created_at: existing.created_at,
      updated_at: now_iso(),
    };
    set_managed_agent_row(context, agent);
    return agent;
  });
}

/** 删除受管 Agent。 */
export function remove_managed_agent(agent_id_input: string): void {
  const agent_id = normalize_managed_agent_id(agent_id_input);
  withPlatformStore((context) => remove_managed_agent_row(context, agent_id));
}
