/**
 * `city agent` 交互式管理器辅助函数。
 *
 * 关键点（中文）
 * - 负责 Agent 列表、Workspace 映射与配置摘要。
 * - City 生命周期属于根命令，不在 Agent 管理面板中重复表达。
 */

import { ResourceClient } from "../resources/ResourceClient.js";
import { create_agent_tui } from "../resources/ResourceTui.js";
import { t } from "@/shared/CliLocale.js";
import { format_agent_display_label } from "@/city/agent/AgentSelection.js";
import type { AgentManagerAgentSummary } from "@/city/agent/AgentManagerTypes.js";

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function loadAgentSummaries(): Promise<AgentManagerAgentSummary[]> {
  const result = await new ResourceClient().call("agent.list");
  return (result.data as { items: { agent_id: string; name: string; model_id: string | null }[] }).items.map((config) => {
    return {
      id: config.agent_id,
      name: config.name,
      execution_binding: config.model_id ?? "",
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
  const label = format_agent_display_label({ agent_id: agent.id, name: agent.name });
  return t({
    zh: [
      `Agent ${label} · 模型 ${agent.execution_binding || "未配置"}`,
      "配置默认模型、Env，以及内建或第三方 Power Binding。",
    ].join("\n"),
    en: [
      `Agent ${label} · Model ${agent.execution_binding || "not configured"}`,
      "Configure the default model, Env, and built-in or installed Power bindings.",
    ].join("\n"),
  });
}

export async function runCreateFlow(): Promise<void> {
  await create_agent_tui();
}
