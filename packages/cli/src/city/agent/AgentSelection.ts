/**
 * 全局受管 Agent 的列表与持久化运行目标解析。
 *
 * Agent 与 Workspace 分别持久化，但每个 Agent 通过 `workspace_id` 唯一绑定一个
 * Workspace。CLI 只能使用该绑定创建 Runtime，daemon 元数据仅投影宿主运行状态。
 */

import path from "node:path";
import prompts from "@/city/tui/Prompts.js";
import {
  get_managed_agent,
  list_managed_agents,
} from "@/city/process/registry/ManagedAgentRepository.js";
import {
  get_workspace,
  get_workspace_by_path,
  type WorkspaceRegistryRecord,
} from "@/city/process/registry/WorkspaceRepository.js";
import type { ManagedAgent } from "@/city/types/agent/ManagedAgent.js";
import type {
  CliAgentPromptChoice,
  CliManagedAgentView,
} from "@/city/types/agent/AgentSelection.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { CliError } from "@/shared/CliError.js";
import {
  isProcessAlive as is_daemon_process_alive,
  readDaemonPid as read_daemon_pid,
} from "@/city/process/daemon/Manager.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

/** 将 Agent 配置与当前 daemon 投影成 CLI 状态视图。 */
async function to_cli_managed_agent_view(agent: ManagedAgent): Promise<CliManagedAgentView> {
  const workspace = agent.workspace_id ? get_workspace(agent.workspace_id) : null;
  const daemon_pid = await read_daemon_pid(agent.agent_id);
  const running = Boolean(daemon_pid && is_daemon_process_alive(daemon_pid));
  return {
    agent_id: agent.agent_id,
    ...(workspace ? { workspace_path: workspace.workspace_path } : {}),
    status: running ? "running" : "stopped",
  };
}

/** 读取全部受管 Agent 的 CLI 视图。 */
export async function list_registered_agents_for_cli(): Promise<CliManagedAgentView[]> {
  const agents = await Promise.all(
    list_managed_agents().map(to_cli_managed_agent_view),
  );
  return agents.sort((left, right) => {
    const status_priority = Number(right.status === "running") - Number(left.status === "running");
    return status_priority || left.agent_id.localeCompare(right.agent_id);
  });
}

/** 构建交互式 Agent 选项。 */
export function build_cli_agent_prompt_choices(
  agents: CliManagedAgentView[],
): CliAgentPromptChoice[] {
  return agents.map((agent) => ({
    title: agent.agent_id,
    value: agent.agent_id,
    description: agent.workspace_path
      ? `${agent.status} · ${agent.workspace_path}`
      : agent.status,
  }));
}

/** 交互选择一个全局 Agent ID。 */
async function prompt_managed_agent_id(agents: CliManagedAgentView[]): Promise<string | null> {
  const response = (await prompts({
    type: "select",
    name: "agent_id",
    message: "选择 Agent",
    choices: build_cli_agent_prompt_choices(agents),
    initial: 0,
  })) as { agent_id?: string };
  return String(response.agent_id || "").trim() || null;
}

/** 输出全局受管 Agent 列表。 */
export async function emit_registered_agent_list_with_options(options?: {
  /** 是否仅展示运行中的 Agent。 */
  running_only?: boolean;
  /** 是否输出 JSON。 */
  as_json?: boolean;
}): Promise<void> {
  const all_agents = await list_registered_agents_for_cli();
  const agents = options?.running_only
    ? all_agents.filter((agent) => agent.status === "running")
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
      title: options?.running_only ? "Running agents" : "Agents",
      summary: options?.running_only ? "0 running" : "0 managed",
      note: options?.running_only
        ? "No Agent daemon is currently running."
        : "Run `city agent create <workspace_path>` to create one.",
    });
    return;
  }
  emitCliList({
    tone: "accent",
    title: options?.running_only ? "Running agents" : "Agents",
    summary: `${agents.length} managed`,
    items: agents.map((agent) => ({
      tone: agent.status === "running" ? "success" : "info",
      title: agent.agent_id,
      facts: [
        ...(agent.workspace_path ? [{ label: "Workspace", value: agent.workspace_path }] : []),
        { label: "Status", value: agent.status },
      ],
    })),
  });
}

/** 输出全部受管 Agent。 */
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
): Promise<DaemonTarget> {
  const agent = await resolve_agent(agent_id_input);
  const workspace = resolve_bound_workspace(agent, workspace_input);
  return { agent_id: agent.agent_id, workspace_path: workspace.workspace_path };
}

/** 解析 Agent，省略 ID 时只允许 TTY 选择。 */
async function resolve_agent(agent_id_input?: string): Promise<ManagedAgent> {
  const explicit_agent_id = String(agent_id_input || "").trim();
  if (explicit_agent_id) {
    const agent = get_managed_agent(explicit_agent_id);
    if (!agent) throw new CliError({ title: `Agent not found: ${explicit_agent_id}`, fix: "city agent list" });
    return agent;
  }
  const agents = await list_registered_agents_for_cli();
  if (agents.length === 0) {
    throw new CliError({ title: "No managed agents", fix: "city agent create <workspace_path>" });
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({ title: "Agent ID is required", fix: "city agent start <agent_id>" });
  }
  const selected_agent_id = await prompt_managed_agent_id(agents);
  if (!selected_agent_id) throw new CliError({ title: "Agent selection cancelled", exitCode: 0 });
  const selected_agent = get_managed_agent(selected_agent_id);
  if (!selected_agent) throw new Error(`Agent not found: ${selected_agent_id}`);
  return selected_agent;
}

/** 读取 Agent 唯一绑定的 Workspace，并校验调用方显式传入的 Workspace。 */
function resolve_bound_workspace(
  agent: ManagedAgent,
  workspace_input?: string,
): WorkspaceRegistryRecord {
  if (!agent.workspace_id) {
    throw new CliError({
      title: `Agent has no Workspace binding: ${agent.agent_id}`,
      fix: "city agent create <workspace_path>",
    });
  }
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
      fix: `city agent start ${agent.agent_id}`,
    });
  }
  return bound_workspace;
}
