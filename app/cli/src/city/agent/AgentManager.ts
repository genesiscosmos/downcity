/**
 * `city agent` 交互式管理器。
 *
 * Agent 列表统一使用共享的 ManagedTuiRuntime；点击 Agent 后直接进入最近对话。
 * Agent 只有配置和 Workspace 事实，不在界面中暴露独立启停状态。
 */

import { ManagedTuiRuntime } from "@/shared/tui/ManagedTuiRuntime.js";
import { t } from "@/shared/CliLocale.js";
import {
  formatAgentDetail,
  isInteractiveTerminal,
  loadAgentSummaries,
  runCreateFlow,
} from "@/city/agent/AgentManagerHelpers.js";
import { resolveInteractiveChatSession } from "@/city/agent/AgentChatHelpers.js";
import { run_agent_chat_navigation } from "@/city/agent/AgentChatNavigation.js";
import { run_agent_configuration } from "@/city/agent/AgentConfiguration.js";
import type { tui_prompt_option } from "@/shared/types/TuiPrompt.js";

/** Agents 首页中的 City 级动作。 */
export type agent_list_city_action = "federation" | "plugins" | "language" | "help";

/** Agent 列表页面的 City 级导航扩展。 */
export interface interactive_agent_manager_options {
  /** 执行 Agents 首页“设置”分组中的动作。 */
  run_city_action?: (action: agent_list_city_action) => Promise<void>;
}

/** 运行 Agent 列表；点击 Agent 后直接进入最近对话。 */
export async function runInteractiveAgentManager(
  options: interactive_agent_manager_options = {},
): Promise<void> {
  if (!isInteractiveTerminal()) return;

  while (true) {
    const selection = await select_page({
      title: t({ zh: "Agents", en: "Agents" }),
      subtitle: t({
        zh: "选择 Agent，或创建一个新的 Agent。",
        en: "Select an Agent, or create a new one.",
      }),
      footer: t({ zh: "Enter 打开 · Esc / q 退出", en: "Enter open · Esc / q exit" }),
      options: await build_agent_options(options.run_city_action !== undefined),
    });
    if (!selection || selection === "back") return;
    if (selection === "create") {
      await runCreateFlow();
      continue;
    }
    if (is_city_action(selection) && options.run_city_action) {
      try {
        await options.run_city_action(selection);
      } catch (error) {
        await show_message(
          "error",
          error instanceof Error ? error.message : String(error),
        );
      }
      continue;
    }
    await run_agent_chat(selection);
  }
}

/** 解析最近会话并直接进入 Chat；退出后回到 Agents 列表。 */
async function run_agent_chat(agent_id: string): Promise<void> {
  try {
    const interactive = await resolveInteractiveChatSession({
      agent_id,
      options: {},
    });
    if (!interactive.success) {
      await show_message("error", interactive.error || `Agent chat failed: ${agent_id}`);
      return;
    }

    try {
      await run_agent_chat_navigation({
        agent_id,
        session_id: interactive.target.session_id,
        remote_agent: interactive.remote_agent,
        configure_agent: run_agent_configuration,
      });
    } finally {
      await interactive.remote_agent.close();
    }
  } catch (error) {
    await show_message("error", error instanceof Error ? error.message : String(error));
  }
}

async function build_agent_options(
  include_settings: boolean,
): Promise<tui_prompt_option[]> {
  const agents = await loadAgentSummaries();
  return [
    ...agents.map((agent) => ({
      label: agent.id,
      value: agent.id,
      hint: formatAgentDetail(agent),
    })),
    {
      label: t({ zh: "创建 Agent", en: "Create Agent" }),
      value: "create",
      hint: t({ zh: "创建 Agent 配置并登记当前 Workspace", en: "Create an Agent and register the current Workspace" }),
    },
    ...(include_settings
      ? [
          {
            label: t({ zh: "设置", en: "Settings" }),
            value: "section:settings",
            disabled: true,
          },
          {
            label: "Federation",
            value: "federation",
            hint: t({
              zh: "配置 Embassy 登录、当前 Federation 与账户",
              en: "Configure Embassy login, the current Federation, and account",
            }),
          },
          {
            label: "Plugins",
            value: "plugins",
            hint: t({
              zh: "安装、更新和管理全局 Plugin 与配置 profile",
              en: "Install, update, and manage global Plugins and configuration profiles",
            }),
          },
          {
            label: t({ zh: "语言", en: "Language" }),
            value: "language",
            hint: t({ zh: "切换 CLI 默认语言", en: "Change the default CLI language" }),
          },
          {
            label: t({ zh: "命令帮助", en: "Command help" }),
            value: "help",
            hint: t({ zh: "查看脚本化子命令", en: "View scriptable subcommands" }),
          },
        ]
      : []),
    { label: t({ zh: "退出", en: "Exit" }), value: "back" },
  ];
}

function is_city_action(value: string): value is agent_list_city_action {
  return value === "federation"
    || value === "plugins"
    || value === "language"
    || value === "help";
}

async function select_page(input: {
  title: string;
  subtitle: string;
  footer: string;
  options: tui_prompt_option[];
}): Promise<string | undefined> {
  const runtime = new ManagedTuiRuntime({ title: `Downcity · ${input.title}` });
  try {
    return await runtime.select({
      title: input.title,
      subtitle: input.subtitle,
      footer: input.footer,
      options: input.options,
      show_detail: true,
    });
  } finally {
    runtime.close();
  }
}

async function show_message(kind: "info" | "success" | "error", message: string): Promise<void> {
  const runtime = new ManagedTuiRuntime({ title: "Downcity" });
  try {
    await runtime.show_message(kind, message);
  } finally {
    runtime.close();
  }
}
