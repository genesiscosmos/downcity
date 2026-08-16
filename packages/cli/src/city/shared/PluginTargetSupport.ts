/**
 * Agent Workspace 目标解析辅助。
 *
 * 关键点（中文）：该模块只服务 Agent 生命周期与内部 TUI，不再承担 Plugin CLI 的 cwd 推断。
 */

import path from "node:path";
import { CliError } from "@/shared/CliError.js";
import { create_platform_sandbox } from "@/city/sandbox/PlatformSandbox.js";
import { get_agent_config } from "@/city/process/registry/AgentConfigRepository.js";
import {
  get_workspace_by_path,
  list_workspaces,
} from "@/city/process/registry/WorkspaceRepository.js";
import { ensure_agent_execution_model_ready } from "@/city/agent/AgentExecutionModelRecovery.js";
import type { AgentWorkspaceTarget } from "@/city/agent/AgentSelection.js";

/** Agent 启动前预检选项。 */
export interface AgentPreflightOptions {
  /** 是否检查 Shell Sandbox 宿主依赖。 */
  requireShellSandbox?: boolean;
}

/** 执行 Sandbox、Agent Binding 与模型可用性预检。 */
export async function checkAgentPreflight(
  target: AgentWorkspaceTarget,
  options?: AgentPreflightOptions,
): Promise<void> {
  if (options?.requireShellSandbox !== false) {
    const result = await (await create_platform_sandbox()).preflight();
    if (!result.ok) {
      throw new CliError({
        title: "Shell sandbox is not ready",
        note: result.issues.map((issue) => issue.message).join("\n"),
        fix: result.issues.flatMap((issue) => issue.fixes).join("\n"),
      });
    }
  }
  const agent = get_agent_config(target.agent_id);
  const workspace = get_workspace_by_path(target.workspace_path);
  if (!agent || !workspace) {
    throw new CliError({
      title: "Agent target is not managed",
      note: `${target.agent_id} → ${target.workspace_path}`,
      fix: "city agent list",
    });
  }
  await ensure_agent_execution_model_ready(target.agent_id);
}

/** 通过 Agent ID 与当前目录解析一次执行使用的 Workspace。 */
export async function resolveProjectRootByAgentId(agent_id_input: string): Promise<{
  /** Agent ID。 */
  agent_id?: string;
  /** Workspace 绝对路径。 */
  project_root?: string;
  /** 解析失败消息。 */
  error?: string;
}> {
  const agent_id = String(agent_id_input || "").trim().toLowerCase();
  const agent = agent_id ? get_agent_config(agent_id) : null;
  if (!agent) return { error: `Agent not found: ${agent_id_input}` };
  const workspace = get_workspace_by_path(process.cwd()) ?? list_workspaces()[0];
  if (!workspace) return { error: "No registered Workspace is available" };
  return { agent_id: agent.agent_id, project_root: path.resolve(workspace.workspace_path) };
}

/** 校验 Workspace 路径非空。 */
export function validateAgentProjectRoot(project_root: string): string | null {
  return String(project_root || "").trim()
    ? null
    : "Agent Workspace path is required.";
}
