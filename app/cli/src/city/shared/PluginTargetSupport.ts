/**
 * Agent 执行目标解析辅助。
 *
 * 关键点（中文）：该模块只服务 Agent 生命周期与内部 TUI，不再承担 Plugin CLI 的 cwd 推断。
 */

import { CliError } from "@/shared/CliError.js";
import { create_sandbox_provider } from "@/city/sandbox/PlatformSandbox.js";
import { get_agent_config } from "@/city/process/registry/AgentConfigRepository.js";
import { get_workspace_by_path } from "@/city/process/registry/WorkspaceRepository.js";
import { ensure_agent_execution_model_ready } from "@/city/agent/AgentExecutionModelRecovery.js";
import type { AgentExecutionTarget } from "@/city/agent/AgentSelection.js";

/** Agent 启动前预检选项。 */
export interface AgentPreflightOptions {
  /** 是否检查 Shell Sandbox 宿主依赖。 */
  requireShellSandbox?: boolean;
}

/** 执行 Sandbox、Agent Binding 与模型可用性预检。 */
export async function checkAgentPreflight(
  target: AgentExecutionTarget,
  options?: AgentPreflightOptions,
): Promise<void> {
  if (options?.requireShellSandbox !== false) {
    const result = await create_sandbox_provider().check();
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
