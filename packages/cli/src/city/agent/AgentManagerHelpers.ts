/**
 * `city agent` 交互式管理器辅助函数。
 *
 * 关键点（中文）
 * - 负责 Agent 列表、聊天、模型与统一 Plugin Binding 管理。
 * - City 生命周期属于根命令，不在 Agent 管理面板中重复表达。
 */

import prompts from "@/city/tui/Prompts.js";
import { run_agent_create_command } from "@/city/agent/Init.js";
import { chatCommand } from "@/city/agent/AgentChat.js";
import { configure_agent_model } from "@/city/agent/AgentModel.js";
import { list_registered_agents_for_cli } from "@/city/agent/AgentSelection.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { t } from "@/shared/CliLocale.js";
import { get_managed_agent } from "@/city/process/registry/ManagedAgentRepository.js";
import type {
  AgentManagerAgentAction,
  AgentManagerConfigAction,
  AgentManagerListSelection,
  AgentManagerAgentSummary,
} from "@/city/agent/AgentManagerTypes.js";
import { run_interactive_agent_plugin_manager } from "@/city/process/plugin/InteractivePluginManager.js";
import { run_interactive_env_manager } from "@/city/env/InteractiveEnvManager.js";

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function loadAgentSummaries(): Promise<AgentManagerAgentSummary[]> {
  const agents = await list_registered_agents_for_cli();
  return agents.map((agent) => {
    const config = get_managed_agent(agent.agent_id);
    return {
      id: agent.agent_id,
      project_root: agent.workspace_path,
      status: agent.status,
      execution_binding: String(
        config?.execution?.type === "api" ? config.execution.model_id || "" : "",
      ).trim(),
    };
  });
}

/**
 * 重新加载单个 agent 摘要。
 *
 * 关键点（中文）
 * - 交互式 manager 不能长期持有旧快照，否则启动/停止后菜单状态会误导用户。
 */
export async function reloadAgentSummary(
  agent_id: string,
  fallback: AgentManagerAgentSummary,
): Promise<AgentManagerAgentSummary> {
  const agents = await loadAgentSummaries();
  return agents.find((agent) => agent.id === agent_id) || fallback;
}

export function formatAgentDetail(agent: AgentManagerAgentSummary): string {
  const execution_binding = agent.execution_binding || t({
    zh: "未配置",
    en: "not configured",
  });
  return t({
    zh: [
      `City ${agent.status === "loaded" ? "已加载" : "未加载"} · 模型 ${execution_binding}`,
      "Enter 进入管理面板。",
    ].join("\n"),
    en: [
      `Status ${agent.status} · Model ${execution_binding}`,
      "Press Enter to manage this agent.",
    ].join("\n"),
  });
}

export async function promptAgentListSelection(
  lastMessage?: string,
): Promise<AgentManagerListSelection | null> {
  const agents = await loadAgentSummaries();
  const response = (await prompts({
    type: "select",
    name: "selection",
    message: t({ zh: "Agent 管理", en: "Agent management" }),
    subtitle: lastMessage,
    choices: [
      {
        title: t({ zh: "Agent 列表", en: "Agents" }),
        disabled: true,
      },
      ...agents.map((agent) => ({
        title: agent.status === "loaded"
          ? t({ zh: `${agent.id} · City 已加载`, en: `${agent.id} · loaded by City` })
          : t({ zh: `${agent.id} · 可直接使用`, en: `${agent.id} · locally available` }),
        description: formatAgentDetail(agent),
        value: {
          type: "agent" as const,
          agent_id: agent.id,
        },
      })),
      {
        title: t({ zh: "操作", en: "Actions" }),
        disabled: true,
      },
      {
        title: t({ zh: "创建 Agent", en: "Create agent" }),
        description: t({
          zh: agents.length === 0
            ? "当前还没有登记 Agent。创建一个新的 Agent 项目，并生成运行所需的基础配置。"
            : "创建一个新的 Agent 项目，并生成运行所需的基础配置。",
          en: agents.length === 0
            ? "No agents are registered yet. Create a new agent project with the required runtime configuration."
            : "Create a new agent project with the required runtime configuration.",
        }),
        value: {
          type: "create" as const,
        },
      },
      {
        title: t({ zh: "导航", en: "Navigation" }),
        disabled: true,
      },
      {
        title: t({ zh: "退出", en: "Exit" }),
        description: t({
          zh: "关闭 Agent 管理器，返回终端。",
          en: "Close the Agent manager and return to the terminal.",
        }),
        value: {
          type: "exit" as const,
        },
      },
    ],
    initial: agents.length > 0 ? 1 : 2,
  })) as { selection?: AgentManagerListSelection };

  return response.selection || null;
}

export async function promptAgentAction(
  agent: AgentManagerAgentSummary,
  lastMessage?: string,
): Promise<AgentManagerAgentAction | null> {
  const response = (await prompts({
    type: "select",
    name: "action",
    message: t({
      zh: `管理 Agent · ${agent.id}`,
      en: `Manage agent · ${agent.id}`,
    }),
    subtitle: lastMessage,
    choices: [
      {
        title: t({ zh: "Agent", en: "Agent" }),
        disabled: true,
      },
      {
        title: t({ zh: "聊天", en: "Chat" }),
        description: t({
          zh: "进入 Agent 对话；City 未启动时使用临时本地运行时。",
          en: "Open Agent chat; use a temporary local runtime when City is off.",
        }),
        value: "chat",
      },
      {
        title: t({ zh: "配置", en: "Config" }),
        description: formatAgentConfigPanelDescription(agent),
        value: "configure",
      },
      {
        title: t({ zh: "导航", en: "Navigation" }),
        disabled: true,
      },
      {
        title: t({ zh: "返回", en: "Back" }),
        description: t({
          zh: "回到 Agent 列表与顶层管理菜单。",
          en: "Return to the agent list and top-level management menu.",
        }),
        value: "back",
      },
    ],
    initial: 0,
  })) as { action?: AgentManagerAgentAction };

  return response.action || null;
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

export async function promptAgentConfigAction(
  agent: AgentManagerAgentSummary,
): Promise<AgentManagerConfigAction | null> {
  const response = (await prompts({
    type: "select",
    name: "action",
    message: t({
      zh: `配置 Agent · ${agent.id}`,
      en: `Configure agent · ${agent.id}`,
    }),
    choices: [
      {
        title: t({ zh: "配置", en: "Config" }),
        disabled: true,
      },
      {
        title: t({ zh: "配置默认模型", en: "Configure default model" }),
        description: t({
          zh: "从当前 Federation 的 AI models 中选择 Agent 默认模型。",
          en: "Select the Agent default model from the active Federation AI models.",
        }),
        value: "configureModel",
      },
      {
        title: t({ zh: "配置 Plugins", en: "Configure Plugins" }),
        description: t({
          zh: "统一启用、禁用和配置当前 Agent 的内建或第三方 Plugin。",
          en: "Enable, disable, and configure built-in or installed Plugins for this Agent.",
        }),
        value: "configurePlugins",
      },
      {
        title: t({ zh: "配置 Env", en: "Configure Env" }),
        description: t({
          zh: "编辑当前 Agent Workspace 的 .env，并同步运行中的 Agent。",
          en: "Edit this Agent Workspace .env and synchronize the running Agent.",
        }),
        value: "configureEnv",
      },
      {
        title: t({ zh: "导航", en: "Navigation" }),
        disabled: true,
      },
      {
        title: t({ zh: "返回", en: "Back" }),
        description: t({
          zh: "回到当前 Agent 的侧边栏。",
          en: "Return to this agent's sidebar.",
        }),
        value: "back",
      },
    ],
    initial: 1,
  })) as { action?: AgentManagerConfigAction };

  return response.action || null;
}

export async function runCreateFlow(): Promise<void> {
  await run_agent_create_command(undefined, {});
}

export async function runSelectedAgentManager(agent_input: AgentManagerAgentSummary): Promise<void> {
  let agent = agent_input;
  let last_message = "";
  while (true) {
    agent = await reloadAgentSummary(agent.id, agent);
    const action = await promptAgentAction(agent, last_message);
    last_message = "";
    if (!action) {
      emitCliBlock({
        tone: "info",
        title: "Agent manager closed",
      });
      return;
    }
    if (action === "back") return;

    try {
      if (action === "chat") {
        await chatCommand({ to: agent.id });
        agent = await reloadAgentSummary(agent.id, agent);
        continue;
      }
      if (action === "configure") {
        const config_action = await promptAgentConfigAction(agent);
        if (!config_action || config_action === "back") {
          continue;
        }
        if (config_action === "configureModel") {
          const result = await configure_agent_model(agent.id);
          agent = await reloadAgentSummary(agent.id, agent);
          last_message = result?.changed
            ? t({
                zh: `Agent 默认模型已更新：${result.current_model_id}`,
                en: `Agent default model updated: ${result.current_model_id}`,
              })
            : t({ zh: "模型未修改", en: "Model unchanged" });
          continue;
        }
        if (config_action === "configurePlugins") {
          await run_interactive_agent_plugin_manager(agent.id);
          agent = await reloadAgentSummary(agent.id, agent);
          last_message = t({
            zh: "Plugin Binding 已更新",
            en: "Plugin bindings updated",
          });
          continue;
        }
        if (config_action === "configureEnv") {
          await run_interactive_env_manager(agent.id);
          agent = await reloadAgentSummary(agent.id, agent);
          last_message = t({
            zh: "Workspace Env 已更新",
            en: "Workspace Env updated",
          });
          continue;
        }
      }
    } catch (error) {
      last_message = t({
        zh: `操作失败：${format_agent_action_error(error)}`,
        en: `Action failed: ${format_agent_action_error(error)}`,
      });
    }
  }
}

function format_agent_action_error(error: unknown): string {
  if (error && typeof error === "object" && "note" in error) {
    const note = String((error as { note?: unknown }).note ?? "").trim();
    if (note) return note;
  }
  return error instanceof Error ? error.message : String(error);
}
