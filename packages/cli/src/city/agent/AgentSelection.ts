/**
 * Agent 配置列表与持久化运行目标解析。
 *
 * Agent 与 Workspace 分别持久化。CLI 在每次执行时显式解析二者，不保存绑定。
 */

import path from "node:path";
import prompts from "@/city/tui/Prompts.js";
import {
  get_agent_config,
  list_agent_configs,
} from "@/city/process/registry/AgentConfigRepository.js";
import {
  get_workspace,
  get_workspace_by_path,
  list_workspaces,
  type WorkspaceRegistryRecord,
} from "@/city/process/registry/WorkspaceRepository.js";
import type { AgentConfig } from "@/city/types/agent/AgentConfig.js";
import type {
  CliAgentPromptChoice,
  CliAgentView,
} from "@/city/types/agent/AgentSelection.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { CliError } from "@/shared/CliError.js";
import {
  is_process_alive,
  read_daemon_meta,
  read_daemon_pid,
} from "@/city/process/daemon/Manager.js";

/** 一次执行所选的 Agent 与 Workspace 目标。 */
export interface AgentWorkspaceTarget {
  /** Agent 稳定 ID。 */
  agent_id: string;
  /** 当前执行使用的 Workspace 稳定 ID。 */
  workspace_id: string;
  /** 当前执行所选 Workspace 的绝对路径。 */
  workspace_path: string;
}

/**
 * 解析只属于 Agent 的配置目标。
 *
 * Plugin 注册、Token 与默认模型等 Agent 级操作不能要求当前目录属于某个 Workspace。
 */
export async function resolve_cli_agent_id(agent_id_input?: string): Promise<string> {
  return (await resolve_agent(agent_id_input)).agent_id;
}

/** 将 Agent 配置与当前 City runtime 投影成 CLI 视图。 */
async function to_cli_agent_view(agent: AgentConfig): Promise<CliAgentView> {
  const daemon_pid = await read_daemon_pid();
  const meta = daemon_pid && is_process_alive(daemon_pid) ? await read_daemon_meta() : null;
  const active = meta?.pid === daemon_pid && meta.agent_ids.includes(agent.agent_id);
  return {
    agent_id: agent.agent_id,
    status: active ? "loaded" : "unloaded",
  };
}

/** 读取全部已登记 Agent 的 CLI 视图。 */
export async function list_registered_agents_for_cli(): Promise<CliAgentView[]> {
  const agents = await Promise.all(
    list_agent_configs().map(to_cli_agent_view),
  );
  return agents.sort((left, right) => {
    const status_priority = Number(right.status === "loaded") - Number(left.status === "loaded");
    return status_priority || left.agent_id.localeCompare(right.agent_id);
  });
}

/** 构建交互式 Agent 选项。 */
export function build_cli_agent_prompt_choices(
  agents: CliAgentView[],
): CliAgentPromptChoice[] {
  return agents.map((agent) => ({
    title: agent.agent_id,
    value: agent.agent_id,
    description: agent.status === "loaded" ? "City active" : "City inactive",
  }));
}

/** 交互选择一个全局 Agent ID。 */
async function prompt_agent_id(agents: CliAgentView[]): Promise<string | null> {
  const response = (await prompts({
    type: "select",
    name: "agent_id",
    message: "选择 Agent",
    choices: build_cli_agent_prompt_choices(agents),
    initial: 0,
  })) as { agent_id?: string };
  return String(response.agent_id || "").trim() || null;
}

/** 输出全局 Agent 配置列表。 */
export async function emit_registered_agent_list_with_options(options?: {
  /** 是否仅展示当前 CLI City runtime 持有的 Agent。 */
  running_only?: boolean;
  /** 是否输出 JSON。 */
  as_json?: boolean;
}): Promise<void> {
  const all_agents = await list_registered_agents_for_cli();
  const agents = options?.running_only
    ? all_agents.filter((agent) => agent.status === "loaded")
    : all_agents;
  if (options?.as_json) {
    printResult({
      type: "block",
      asJson: true,
      success: true,
      title: "agents",
      data: { count: agents.length, running_only: options.running_only === true, agents },
    });
    return;
  }
  if (agents.length === 0) {
    emitCliBlock({
      tone: "info",
      title: options?.running_only ? "City-active Agents" : "Agents",
      summary: options?.running_only ? "0 active" : "0 registered",
      note: options?.running_only
        ? "The CLI City runtime does not currently hold any Agents."
        : "Run `city agent create <workspace_path>` to create one.",
    });
    return;
  }
  emitCliList({
    tone: "accent",
    title: options?.running_only ? "City-active Agents" : "Agents",
    summary: `${agents.length} registered`,
    items: agents.map((agent) => ({
      tone: agent.status === "loaded" ? "success" : "info",
      title: agent.agent_id,
      facts: [
        { label: "City runtime", value: agent.status === "loaded" ? "active" : "inactive" },
      ],
    })),
  });
}

/** 输出全部已登记 Agent。 */
export async function emit_registered_agent_list(): Promise<void> {
  await emit_registered_agent_list_with_options();
}

/**
 * 解析命令目标 Agent 与本次执行使用的 Workspace。
 */
export async function resolve_cli_agent_target(
  agent_id_input?: string,
  workspace_input?: string,
): Promise<AgentWorkspaceTarget> {
  const agent_id = await resolve_cli_agent_id(agent_id_input);
  const workspace = await resolve_workspace(workspace_input);
  return {
    agent_id,
    workspace_id: workspace.workspace_id,
    workspace_path: workspace.workspace_path,
  };
}

/** 解析 Agent，省略 ID 时只允许 TTY 选择。 */
async function resolve_agent(agent_id_input?: string): Promise<AgentConfig> {
  const explicit_agent_id = String(agent_id_input || "").trim();
  if (explicit_agent_id) {
    const agent = get_agent_config(explicit_agent_id);
    if (!agent) throw new CliError({ title: `Agent not found: ${explicit_agent_id}`, fix: "city agent list" });
    return agent;
  }
  const agents = await list_registered_agents_for_cli();
  if (agents.length === 0) {
    throw new CliError({ title: "No registered agents", fix: "city agent create <workspace_path>" });
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({ title: "Agent ID is required", fix: "city agent list" });
  }
  const selected_agent_id = await prompt_agent_id(agents);
  if (!selected_agent_id) throw new CliError({ title: "Agent selection cancelled", exitCode: 0 });
  const selected_agent = get_agent_config(selected_agent_id);
  if (!selected_agent) throw new Error(`Agent not found: ${selected_agent_id}`);
  return selected_agent;
}

/** 解析显式 Workspace ID/路径，省略时优先使用当前目录。 */
async function resolve_workspace(workspace_input?: string): Promise<WorkspaceRegistryRecord> {
  const explicit = String(workspace_input || "").trim();
  const current_workspace = get_workspace_by_path(path.resolve(explicit || process.cwd()));
  const resolved = explicit
    ? get_workspace(explicit) ?? current_workspace
    : current_workspace;
  if (resolved) return resolved;

  const workspaces = list_workspaces();
  if (!explicit && workspaces.length === 1) return workspaces[0];
  if (!explicit && process.stdin.isTTY && process.stdout.isTTY && workspaces.length > 1) {
    const response = await prompts({
      type: "select",
      name: "workspace_id",
      message: "选择 Workspace",
      choices: workspaces.map((workspace) => ({
        title: workspace.name || workspace.workspace_id,
        value: workspace.workspace_id,
        description: workspace.workspace_path,
      })),
      initial: 0,
    }) as { workspace_id?: string };
    const selected = get_workspace(String(response.workspace_id || ""));
    if (selected) return selected;
  }
  if (explicit) {
    throw new CliError({
      title: `Workspace not registered: ${explicit}`,
      fix: "city agent create <workspace_path>",
    });
  }
  throw new CliError({
    title: "Workspace is required",
    note: "Run the command from a registered Workspace or pass --workspace.",
    fix: "city agent create <workspace_path>",
  });
}
