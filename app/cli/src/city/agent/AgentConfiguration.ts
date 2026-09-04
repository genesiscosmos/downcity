/**
 * Agent 配置页面。
 *
 * 关键点（中文）
 * - 该页面只编排 Agent 自身配置入口，不拥有 Chat 或 Agent 列表导航。
 * - Chat 退出 alternate screen 后才会进入这里，避免多个 TUI 同时控制终端。
 */

import { formatAgentConfigPanelDescription, loadAgentSummaries } from "@/city/agent/AgentManagerHelpers.js";
import { configure_agent_model } from "@/city/agent/AgentModel.js";
import { run_interactive_env_manager } from "@/city/env/InteractiveEnvManager.js";
import { run_interactive_agent_plugin_manager } from "@/city/process/plugin/InteractivePluginManager.js";
import { t } from "@/shared/CliLocale.js";
import { ManagedTuiRuntime } from "@/shared/tui/ManagedTuiRuntime.js";

/** 打开指定 Agent 的配置页，直到用户返回 Chat。 */
export async function run_agent_configuration(agent_id: string): Promise<void> {
  while (true) {
    const agent = (await loadAgentSummaries()).find((item) => item.id === agent_id);
    if (!agent) return;

    const runtime = new ManagedTuiRuntime({ title: `Downcity · ${agent.id} · Configuration` });
    let action: string | undefined;
    try {
      action = await runtime.select({
        title: t({ zh: `${agent.id} · 配置`, en: `${agent.id} · Configuration` }),
        subtitle: formatAgentConfigPanelDescription(agent),
        footer: t({ zh: "Enter 打开 · Esc / q 返回对话", en: "Enter open · Esc / q back to chat" }),
        options: [
          {
            label: t({ zh: "默认模型", en: "Default model" }),
            value: "configure_model",
            hint: t({ zh: "选择 Agent 的默认对话模型", en: "Choose the Agent default chat model" }),
          },
          {
            label: "Plugins",
            value: "configure_plugins",
            hint: t({ zh: "启用、禁用和配置 Agent Plugin", en: "Enable, disable, and configure Agent Plugins" }),
          },
          {
            label: "Workspace Env",
            value: "configure_env",
            hint: t({ zh: "编辑当前 Workspace 的环境变量", en: "Edit environment variables for this Workspace" }),
          },
          { label: t({ zh: "返回对话", en: "Back to chat" }), value: "back" },
        ],
        show_detail: true,
      });
    } finally {
      runtime.close();
    }

    if (!action || action === "back") return;
    if (action === "configure_model") await configure_agent_model(agent_id);
    if (action === "configure_plugins") await run_interactive_agent_plugin_manager(agent_id);
    if (action === "configure_env") await run_interactive_env_manager(agent_id);
  }
}
