/**
 * Agent 配置列表与持久化运行目标解析。
 *
 * Agent 与 Workspace 分别持久化，但每个 Agent 通过 `workspace_id` 唯一绑定一个
 * Workspace。CLI 只能使用该绑定创建 Runtime，daemon 元数据仅投影宿主运行状态。
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

/** Agent 与其唯一 Workspace 绑定，用于一次性本地调用。 */
export interface AgentWorkspaceTarget {
  /** Agent 稳定 ID。 */
  agent_id: string;
  /** 绑定的 Workspace 绝对路径。 */
  workspace_path: string;
}

/** 将 Agent 配置与当前 daemon 投影成 CLI 状态视图。 */
async function to_cli_agent_view(agent: AgentConfig): Promise<CliAgentView> {
  const workspace = get_workspace(agent.workspace_id);
  if (!workspace) {
    throw new Error(`Workspace not found: ${agent.workspace_id}`);
  }
  const daemon_pid = await read_daemon_pid();
  const meta = daemon_pid && is_process_alive(daemon_pid) ? await read_daemon_meta() : null;
  const loaded = meta?.pid === daemon_pid && meta.agent_ids.includes(agent.agent_id);
  return {
    agent_id: agent.agent_id,
    workspace_path: workspace.workspace_path,
    status: loaded ? "loaded" : "unloaded",
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
    description: `${agent.status} · ${agent.workspace_path}`,
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
  /** 是否仅展示当前 CLI City 已加载的 Agent。 */
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
      asJson: true,
      success: true,
      title: "agents",
      payload: { count: agents.length, running_only: options.running_only === true, agents },
    });
    return;
  }
  if (agents.length === 0) {
    emitCliBlock({
      tone: "info",
      title: options?.running_only ? "City-loaded Agents" : "Agents",
      summary: options?.running_only ? "0 loaded" : "0 registered",
      note: options?.running_only
        ? "The CLI City has not loaded any Agents."
        : "Run `city agent create <workspace_path>` to create one.",
    });
    return;
  }
  emitCliList({
    tone: "accent",
    title: options?.running_only ? "City-loaded Agents" : "Agents",
    summary: `${agents.length} registered`,
    items: agents.map((agent) => ({
      tone: agent.status === "loaded" ? "success" : "info",
      title: agent.agent_id,
      facts: [
        { label: "Workspace", value: agent.workspace_path },
        { label: "City", value: agent.status },
      ],
    })),
  });
}

/** 输出全部已登记 Agent。 */
export async function emit_registered_agent_list(): Promise<void> {
  await emit_registered_agent_list_with_options();
}

/**
 * 解析命令目标 Agent 与其持久化绑定的 Workspace。
 *
 * 可选 Workspace 参数只用于校验调用方预期，不允许在启动时临时替换绑定。
 */
export async function resolve_cli_agent_target(
  agent_id_input?: string,
  workspace_input?: string,
): Promise<AgentWorkspaceTarget> {
  const agent = await resolve_agent(agent_id_input);
  const workspace = resolve_bound_workspace(agent, workspace_input);
  return { agent_id: agent.agent_id, workspace_path: workspace.workspace_path };
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

/** 读取 Agent 唯一绑定的 Workspace，并校验调用方显式传入的 Workspace。 */
function resolve_bound_workspace(
  agent: AgentConfig,
  workspace_input?: string,
): WorkspaceRegistryRecord {
  const bound_workspace = get_workspace(agent.workspace_id);
  if (!bound_workspace) {
    throw new CliError({
      title: `Agent Workspace is not registered: ${agent.workspace_id}`,
      note: agent.agent_id,
      fix: "city agent list",
    });
  }

  const explicit = String(workspace_input || "").trim();
  if (!explicit) return bound_workspace;
  const explicit_workspace = get_workspace(explicit)
    ?? get_workspace_by_path(path.resolve(explicit));
  if (!explicit_workspace) {
    throw new CliError({
      title: `Workspace not registered: ${explicit}`,
      fix: "city agent create <workspace_path>",
    });
  }
  if (explicit_workspace.workspace_id !== bound_workspace.workspace_id) {
    throw new CliError({
      title: `Agent is bound to another Workspace: ${agent.agent_id}`,
      note: bound_workspace.workspace_path,
      fix: `city agent list`,
    });
  }
  return bound_workspace;
}
