/**
 * `city agent` 交互式管理器辅助函数。
 *
 * 关键点（中文）
 * - 负责 Agent 列表、Workspace 映射与配置摘要。
 * - City 生命周期属于根命令，不在 Agent 管理面板中重复表达。
 */

import { run_agent_create_command } from "@/city/agent/Init.js";
import { t } from "@/shared/CliLocale.js";
import { list_agent_configs } from "@/city/process/registry/AgentConfigRepository.js";
import type { AgentManagerAgentSummary } from "@/city/agent/AgentManagerTypes.js";

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function loadAgentSummaries(): Promise<AgentManagerAgentSummary[]> {
  return list_agent_configs().map((config) => {
    return {
      id: config.agent_id,
      execution_binding: String(
        config?.execution?.type === "api" ? config.execution.model_id || "" : "",
      ).trim(),
    };
  });
}

export function formatAgentDetail(agent: AgentManagerAgentSummary): string {
  const execution_binding = agent.execution_binding || t({
    zh: "未配置",
    en: "not configured",
  });
  return t({
    zh: [
      "Workspace：执行时选择",
      `默认模型：${execution_binding}`,
      "Enter 打开 Agent。",
    ].join("\n"),
    en: [
      "Workspace: selected when running",
      `Default model: ${execution_binding}`,
      "Press Enter to open the Agent.",
    ].join("\n"),
  });
}

export function formatAgentConfigPanelDescription(agent: AgentManagerAgentSummary): string {
  return t({
    zh: [
      `Agent ${agent.id} · 模型 ${agent.execution_binding || "未配置"}`,
      "配置默认模型、Env，以及内建或第三方 Plugin Binding。",
    ].join("\n"),
    en: [
      `Agent ${agent.id} · Model ${agent.execution_binding || "not configured"}`,
      "Configure the default model, Env, and built-in or installed Plugin bindings.",
    ].join("\n"),
  });
}

export async function runCreateFlow(): Promise<void> {
  await run_agent_create_command(undefined, {});
}
