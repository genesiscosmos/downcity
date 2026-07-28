/**
 * `city agent` 交互式管理器辅助函数。
 *
 * 关键点（中文）
 * - 负责 Agent 列表、模型和统一 Plugin Binding 管理，以及运行时操作封装。
 * - 交互式 manager 不能长期持有旧快照，启动/停止后需要重新加载摘要。
 */

import prompts from "@/city/tui/Prompts.js";
import { run_agent_create_command } from "@/city/agent/Init.js";
import { runCommand } from "@/city/agent/Run.js";
import { startCommand } from "@/city/agent/Start.js";
import { stopCommand } from "@/city/agent/Stop.js";
import { restartCommand } from "@/city/agent/Restart.js";
import { chatCommand } from "@/city/agent/AgentChat.js";
import { configure_agent_model } from "@/city/agent/AgentModel.js";
import { list_registered_agents_for_cli } from "@/city/agent/AgentSelection.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { inject_agent_context } from "@/shared/IndexSupport.js";
import { prepareForegroundAgent } from "@/city/shared/CityAgentRuntime.js";
import { t } from "@/shared/CliLocale.js";
import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import { get_managed_agent } from "@/city/process/registry/ManagedAgentRepository.js";
import type {
  AgentManagerAgentAction,
  AgentManagerConfigAction,
  AgentManagerListSelection,
  AgentManagerAgentSummary,
} from "@/city/agent/AgentManagerTypes.js";
import { run_interactive_agent_plugin_manager } from "@/city/process/plugin/InteractivePluginManager.js";

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
      `状态 ${agent.status === "running" ? "运行中" : "已停止"} · 模型 ${execution_binding}`,
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
        title: agent.status === "running"
          ? t({ zh: `${agent.id} · 运行中`, en: `${agent.id} · running` })
          : t({ zh: `${agent.id} · 已停止`, en: `${agent.id} · stopped` }),
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
      ...startActionChoices(agent),
      {
        title: t({ zh: "聊天", en: "Chat" }),
        description: t({
          zh: "进入与当前运行中 Agent 的终端对话。",
          en: "Open a terminal conversation with the currently running agent.",
        }),
        value: "chat",
      },
      {
        title: t({ zh: "配置", en: "Config" }),
        description: formatAgentConfigPanelDescription(agent),
        value: "configure",
      },
      ...stopAndRestartActionChoices(agent),
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
      "配置默认模型，以及内建或第三方 Plugin Binding。",
    ].join("\n"),
    en: [
      `Agent ${agent.id} · Model ${agent.execution_binding || "not configured"}`,
      "Configure the default model and built-in or installed Plugin bindings.",
    ].join("\n"),
  });
}

export function startActionChoices(
  agent: AgentManagerAgentSummary,
): Array<{
  title: string;
  description: string;
  value: AgentManagerAgentAction;
  disabled?: boolean;
}> {
  if (agent.status === "running") {
    return [];
  }

  return [
    {
      title: t({ zh: "启动", en: "Start" }),
      description: t({
        zh: "启动当前 Agent daemon，并刷新运行状态。",
        en: "Start the current agent daemon and refresh runtime status.",
      }),
      value: "start",
    },
  ];
}

export function stopAndRestartActionChoices(
  agent: AgentManagerAgentSummary,
): Array<{
  title: string;
  description?: string;
  value?: AgentManagerAgentAction;
  disabled?: boolean;
}> {
  if (agent.status !== "running") {
    return [];
  }

  return [
    {
      title: t({ zh: "运行操作", en: "Runtime actions" }),
      disabled: true,
    },
    {
      title: t({ zh: "停止", en: "Stop" }),
      description: t({
        zh: "停止当前 Agent daemon，但保留项目配置。",
        en: "Stop the current agent daemon while keeping project configuration.",
      }),
      value: "stop",
    },
    {
      title: t({ zh: "重启", en: "Restart" }),
      description: t({
        zh: "重启当前 Agent daemon，适合配置更新后重新加载。",
        en: "Restart the current agent daemon, useful after configuration changes.",
      }),
      value: "restart",
    },
  ];
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

export async function startAgentProject(
  agent_id: string,
  project_root: string,
): Promise<void> {
  const options: AgentStartOptions & { foreground?: boolean } = {};
  const prepared = await prepareForegroundAgent({
    agent_id,
    workspace_path: project_root,
  }, options);
  if (prepared.should_foreground) {
    await runCommand(prepared.target, prepared.options);
    return;
  }
  await startCommand(prepared.target, prepared.options);
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
      if (action === "start") {
        await startAgentProject(agent.id, agent.project_root);
        const previous_agent = agent;
    agent = await reloadAgentSummary(agent.id, agent);
        last_message = format_agent_start_result(previous_agent, agent);
        continue;
      }
      if (action === "stop") {
        const previous_agent = agent;
        await stopCommand({
          agent_id: agent.id,
          workspace_path: agent.project_root,
        });
    agent = await reloadAgentSummary(agent.id, agent);
        last_message = format_agent_stop_result(previous_agent, agent);
        continue;
      }
      if (action === "restart") {
        const previous_agent = agent;
        inject_agent_context({
          agent_id: agent.id,
          workspace_path: agent.project_root,
        });
        await restartCommand({
          agent_id: agent.id,
          workspace_path: agent.project_root,
        }, {});
    agent = await reloadAgentSummary(agent.id, agent);
        last_message = format_agent_restart_result(previous_agent, agent);
        continue;
      }
      if (action === "chat") {
    agent = await reloadAgentSummary(agent.id, agent);
        if (agent.status !== "running") {
          last_message = t({
            zh: "无法聊天：请先启动当前 Agent",
            en: "Cannot chat: start this agent first",
          });
          continue;
        }
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

function format_agent_start_result(
  _previous_agent: AgentManagerAgentSummary,
  next_agent: AgentManagerAgentSummary,
): string {
  if (next_agent.status === "running") {
    return t({
      zh: `已启动 ${next_agent.id}`,
      en: `Started ${next_agent.id}`,
    });
  }
  return t({
    zh: `启动未生效：${next_agent.id} 仍是已停止`,
    en: `Start did not take effect: ${next_agent.id} is still stopped`,
  });
}

function format_agent_stop_result(
  previous_agent: AgentManagerAgentSummary,
  next_agent: AgentManagerAgentSummary,
): string {
  if (next_agent.status === "stopped") {
    return previous_agent.status === "running"
      ? t({
        zh: `已停止 ${next_agent.id}`,
        en: `Stopped ${next_agent.id}`,
      })
      : t({
        zh: `${next_agent.id} 本来就是已停止`,
        en: `${next_agent.id} was already stopped`,
      });
  }
  return t({
    zh: `停止未生效：${next_agent.id} 仍在运行`,
    en: `Stop did not take effect: ${next_agent.id} is still running`,
  });
}

function format_agent_restart_result(
  _previous_agent: AgentManagerAgentSummary,
  next_agent: AgentManagerAgentSummary,
): string {
  if (next_agent.status === "running") {
    return t({
      zh: `已重启 ${next_agent.id}`,
      en: `Restarted ${next_agent.id}`,
    });
  }
  return t({
    zh: `重启未生效：${next_agent.id} 当前已停止`,
    en: `Restart did not take effect: ${next_agent.id} is stopped`,
  });
}
