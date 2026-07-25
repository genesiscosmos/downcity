/**
 * 全局受管 Agent 的列表与目标选择。
 *
 * 关键点（中文）
 * - `agent_id` 是选择和命令调用的唯一稳定值。
 * - 当前目录仅用于反查绑定 Agent；同一路径存在多个 Agent 时必须交互选择或显式传 ID。
 * - 运行状态当前由 Daemon lease 推导，不写回 Agent 配置。
 */

import path from "node:path";
import prompts from "@/city/tui/Prompts.js";
import {
  get_managed_agent,
  list_managed_agents,
  list_managed_agents_by_workspace,
} from "@/city/process/registry/ManagedAgentRepository.js";
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

/** 将数据库实体转换为 CLI 状态视图。 */
async function to_cli_managed_agent_view(agent: {
  agent_id: string;
  workspace_path: string;
}): Promise<CliManagedAgentView> {
  const daemon_pid = await read_daemon_pid(agent.agent_id);
  return {
    agent_id: agent.agent_id,
    workspace_path: agent.workspace_path,
    status: daemon_pid && is_daemon_process_alive(daemon_pid)
      ? "running"
      : "stopped",
  };
}

/** 读取全部受管 Agent 的 CLI 视图。 */
export async function list_registered_agents_for_cli(): Promise<CliManagedAgentView[]> {
  const agents = await Promise.all(
    list_managed_agents().map((agent) => to_cli_managed_agent_view(agent)),
  );
  return agents.sort((left, right) => {
    const status_priority = Number(right.status === "running") -
      Number(left.status === "running");
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
    description: `${agent.status} · ${agent.workspace_path}`,
  }));
}

/** 交互选择一个全局 Agent ID。 */
async function prompt_managed_agent_id(
  agents: CliManagedAgentView[],
): Promise<string | null> {
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
      payload: {
        count: agents.length,
        running_only: options.running_only === true,
        agents,
      },
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
        { label: "Workspace", value: agent.workspace_path },
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
 * 解析命令目标 Agent。
 *
 * 优先级（中文）
 * 1. 显式 `agent_id`。
 * 2. 当前目录唯一绑定的 Agent。
 * 3. 交互选择。
 */
export async function resolve_cli_agent_target(
  agent_id_input?: string,
): Promise<{ agent_id: string; workspace_path: string }> {
  const explicit_agent_id = String(agent_id_input || "").trim();
  if (explicit_agent_id) {
    const agent = get_managed_agent(explicit_agent_id);
    if (!agent) {
      throw new CliError({
        title: `Agent not found: ${explicit_agent_id}`,
        fix: "city agent list",
      });
    }
    return {
      agent_id: agent.agent_id,
      workspace_path: agent.workspace_path,
    };
  }

  const current_workspace_path = path.resolve(process.cwd());
  const current_agents = list_managed_agents_by_workspace(current_workspace_path);
  if (current_agents.length === 1) {
    return {
      agent_id: current_agents[0].agent_id,
      workspace_path: current_agents[0].workspace_path,
    };
  }

  const agents = await list_registered_agents_for_cli();
  if (agents.length === 0) {
    throw new CliError({
      title: "No managed agents",
      fix: "city agent create <workspace_path>",
    });
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({
      title: current_agents.length > 1
        ? "Current Workspace is bound to multiple Agents"
        : "Agent ID is required",
      fix: "city agent start <agent_id>",
    });
  }
  const selected_agent_id = await prompt_managed_agent_id(
    current_agents.length > 1
      ? agents.filter((agent) =>
          agent.workspace_path === current_workspace_path
        )
      : agents,
  );
  if (!selected_agent_id) {
    throw new CliError({
      title: "Agent selection cancelled",
      exitCode: 0,
    });
  }
  const selected_agent = get_managed_agent(selected_agent_id);
  if (!selected_agent) throw new Error(`Agent not found: ${selected_agent_id}`);
  return {
    agent_id: selected_agent.agent_id,
    workspace_path: selected_agent.workspace_path,
  };
}
