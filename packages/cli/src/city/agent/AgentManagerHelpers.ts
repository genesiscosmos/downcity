/**
 * `city agent` 交互式管理器辅助函数。
 *
 * 关键点（中文）
 * - 负责 Agent 列表加载、配置读取、账号绑定、prompts 与运行时操作封装。
 * - 交互式 manager 不能长期持有旧快照，启动/停止后需要重新加载摘要。
 */

import prompts from "@/city/tui/Prompts.js";
import { initCommand } from "@/city/agent/Init.js";
import { runCommand } from "@/city/agent/Run.js";
import { startCommand } from "@/city/agent/Start.js";
import { stopCommand } from "@/city/agent/Stop.js";
import { restartCommand } from "@/city/agent/Restart.js";
import { chatCommand } from "@/city/agent/AgentChat.js";
import { configure_agent_model } from "@/city/agent/AgentModel.js";
import { list_registered_agents_for_cli } from "@/city/agent/AgentSelection.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { inject_agent_context } from "@/shared/IndexSupport.js";
import { prepareForegroundAgent } from "@/city/shared/CityAgentRuntime.js";
import { PlatformStore } from "@/city/runtime/store/index.js";
import { t } from "@/shared/CliLocale.js";
import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import type { DowncityConfig } from "@/city/types/config/DowncityConfig.js";
import type {
  StoredChannelAccount,
  StoredChannelAccountChannel,
} from "@downcity/plugins/chat";
import {
  get_managed_agent,
  update_managed_agent,
} from "@/city/process/registry/ManagedAgentRepository.js";
import type {
  AgentManagerAgentAction,
  AgentManagerConfigAction,
  AgentManagerListSelection,
  AgentManagerAgentSummary,
} from "@/city/agent/AgentManagerTypes.js";

const CHAT_CHANNELS: StoredChannelAccountChannel[] = ["telegram", "feishu", "qq"];

type DanglingChannelAccount = {
  /**
   * 出现悬空引用的聊天渠道。
   */
  channel: StoredChannelAccountChannel;
  /**
   * agent 配置中引用但 City 全局账号池不存在的 account id。
   */
  accountId: string;
};

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function loadAgentSummaries(): Promise<AgentManagerAgentSummary[]> {
  const agents = await list_registered_agents_for_cli();
  return agents.map((agent) => {
    const config = readAgentConfig(agent.agent_id);
    return {
      id: String(config?.id || "").trim() || agent.agent_id,
      project_root: agent.workspace_path,
      status: agent.status,
      execution_binding: readAgentExecutionBinding(config),
      channels: readAgentChannelSummaries(config),
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

export function readAgentConfig(agent_id: string): DowncityConfig | null {
  const agent = get_managed_agent(agent_id);
  if (!agent) return null;
  return {
    id: agent.agent_id,
    version: agent.version,
    ...(agent.start ? { start: agent.start } : {}),
    ...(agent.execution ? { execution: agent.execution } : {}),
    ...(agent.plugins ? { plugins: agent.plugins } : {}),
    ...(agent.llm ? { llm: agent.llm } : {}),
  };
}

/** 保存管理器编辑后的 Agent 配置。 */
function write_agent_config(agent_id: string, config: DowncityConfig): void {
  const agent = get_managed_agent(agent_id);
  if (!agent) throw new Error(`Agent not found: ${agent_id}`);
  update_managed_agent({
    agent_id: agent.agent_id,
    start: config.start,
    execution: config.execution,
    plugins: config.plugins,
    llm: config.llm,
  });
}

export function readAgentExecutionBinding(config: DowncityConfig | null): string {
  return String(config?.execution?.type === "api" ? config.execution.model_id || "" : "").trim();
}

export function readAgentChannelSummaries(config: DowncityConfig | null): string[] {
  const accountsById = loadChannelAccountMap();
  const channels = config?.plugins?.chat?.channels || {};
  const summaries: string[] = [];
  for (const channel of CHAT_CHANNELS) {
    const channelConfig = channels[channel];
    const accountId = String(channelConfig?.channelAccountId || "").trim();
    const enabled = channelConfig?.enabled === true;
    if (!accountId && !enabled) continue;
    const account = accountId ? accountsById.get(accountId) : null;
    const accountLabel = account
      ? account.name
      : accountId
        ? `missing account ${accountId}`
        : "enabled, no account";
    summaries.push(`${channel}:${accountLabel}`);
  }
  return summaries;
}

export function findDanglingChannelAccounts(config: DowncityConfig | null): DanglingChannelAccount[] {
  const accountsById = loadChannelAccountMap();
  const channels = config?.plugins?.chat?.channels || {};
  const dangling: DanglingChannelAccount[] = [];
  for (const channel of CHAT_CHANNELS) {
    const accountId = String(channels[channel]?.channelAccountId || "").trim();
    if (!accountId) continue;
    if (accountsById.has(accountId)) continue;
    dangling.push({ channel, accountId });
  }
  return dangling;
}

export function loadChannelAccounts(channel?: StoredChannelAccountChannel): StoredChannelAccount[] {
  const store = new PlatformStore();
  try {
    return store.listChannelAccountsSync(channel);
  } finally {
    store.close();
  }
}

export function loadChannelAccountMap(): Map<string, StoredChannelAccount> {
  return new Map(loadChannelAccounts().map((account) => [account.id, account]));
}

export function formatAgentDetail(agent: AgentManagerAgentSummary): string {
  const execution_binding = agent.execution_binding || t({
    zh: "未配置",
    en: "not configured",
  });
  const channels = agent.channels.length > 0
    ? agent.channels.length === 1
      ? agent.channels[0]
      : t({ zh: `${agent.channels.length} 个账号`, en: `${agent.channels.length} accounts` })
    : t({ zh: "未连接", en: "not connected" });

  return t({
    zh: [
      `状态 ${agent.status === "running" ? "运行中" : "已停止"} · 模型 ${execution_binding} · Chat ${channels}`,
      "Enter 进入管理面板。",
    ].join("\n"),
    en: [
      `Status ${agent.status} · Model ${execution_binding} · Chat ${channels}`,
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
      `Agent ${agent.id} · 模型 ${agent.execution_binding || "未配置"} · Chat ${agent.channels.length > 0 ? agent.channels.length : "未连接"}`,
      "配置 Agent ID、默认模型或连接 City 全局 Chat 账号。",
    ].join("\n"),
    en: [
      `Agent ${agent.id} · Model ${agent.execution_binding || "not configured"} · Chat ${agent.channels.length > 0 ? agent.channels.length : "not connected"}`,
      "Configure the Agent ID, default model, or City-level Chat accounts.",
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
        title: t({ zh: "连接 Chat 账号", en: "Connect chat accounts" }),
        description: t({
          zh: `当前：${agent.channels.length > 0 ? agent.channels.join(", ") : "未连接"}。把 City 全局 Chat 账号绑定到当前 Agent。`,
          en: `Current: ${agent.channels.length > 0 ? agent.channels.join(", ") : "not connected"}. Bind City-level chat accounts to this agent.`,
        }),
        value: "connectChatAccounts",
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

export async function promptCreateProjectPath(): Promise<string | null> {
  const response = (await prompts({
    type: "text",
    name: "projectPath",
    message: t({ zh: "Agent 项目路径", en: "Agent project path" }),
    initial: ".",
  })) as { projectPath?: string };

  if (response.projectPath === undefined) return null;
  return String(response.projectPath || ".").trim() || ".";
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
  const projectPath = await promptCreateProjectPath();
  if (!projectPath) {
    emitCliBlock({
      tone: "info",
      title: "Agent create cancelled",
    });
    return;
  }
  await initCommand(projectPath, {});
}

export function buildAccountTitle(account: StoredChannelAccount): string {
  const identity = String(account.identity || "").trim();
  return identity ? `${account.name} (${identity})` : account.name;
}

export async function promptChannelAccountId(params: {
  channel: StoredChannelAccountChannel;
  currentAccountId: string;
}): Promise<string | null | undefined> {
  const accounts = loadChannelAccounts(params.channel);
  const choices = [
    {
      title: t({ zh: "不连接", en: "Do not connect" }),
      description: t({
        zh: `关闭 ${params.channel} 与当前 Agent 的关联。`,
        en: `Disable the ${params.channel} connection for the current agent.`,
      }),
      value: "",
    },
    ...accounts.map((account) => ({
      title: buildAccountTitle(account),
      description: account.id,
      value: account.id,
    })),
  ];
  const initial = Math.max(
    0,
    choices.findIndex((choice) => choice.value === params.currentAccountId),
  );
  const response = (await prompts({
    type: "select",
    name: "accountId",
    message: t({
      zh: `连接 ${params.channel} Chat 账号`,
      en: `Connect ${params.channel} chat account`,
    }),
    choices,
    initial,
  })) as { accountId?: string };

  if (response.accountId === undefined) return undefined;
  return String(response.accountId || "").trim() || null;
}

export async function connectAgentChannels(
  agent: AgentManagerAgentSummary,
): Promise<AgentManagerAgentSummary> {
  const raw = readAgentConfig(agent.id);
  const nextRaw: DowncityConfig = {
    id: agent.id,
    version: "1.0.0",
    ...(raw || {}),
  };
  const chatConfig = (((nextRaw.plugins ??= {}) as NonNullable<DowncityConfig["plugins"]>).chat ??= {});
  const channelConfigs = chatConfig.channels ??= {};
  const dangling = findDanglingChannelAccounts(nextRaw);
  if (dangling.length > 0) {
    emitCliList({
      tone: "warning",
      title: "Dangling chat accounts",
      summary: `${dangling.length} found`,
      items: dangling.map((item) => ({
        title: item.channel,
        facts: [
          {
            label: "missing",
            value: item.accountId,
          },
        ],
      })),
    });

    for (const item of dangling) {
      const current = channelConfigs[item.channel];
      channelConfigs[item.channel] = {
        enabled: current?.enabled === true,
      };
    }
    write_agent_config(agent.id, nextRaw);

    const nextConfig = readAgentConfig(agent.id);
    const cleanedAgent = {
      ...agent,
      channels: readAgentChannelSummaries(nextConfig),
    };
    emitCliBlock({
      tone: "success",
      title: "Dangling chat account links removed automatically",
      summary: cleanedAgent.channels.length > 0 ? cleanedAgent.channels.join(", ") : "none",
    });

    const allAccountsAfterCleanup = loadChannelAccounts();
    if (allAccountsAfterCleanup.length === 0) {
      emitCliBlock({
        tone: "info",
        title: "No City chat accounts found",
        note: "已清理悬空关联。请先运行 `city chat`，选择“管理 chat accounts”来配置 Telegram、Feishu 或 QQ account；agent 这里只做 connect。",
      });
      return cleanedAgent;
    }

    agent = cleanedAgent;
  }

  const allAccounts = loadChannelAccounts();
  if (allAccounts.length === 0) {
    emitCliBlock({
      tone: "info",
      title: "No City chat accounts found",
      note: "请先运行 `city chat`，选择“管理 chat accounts”来配置 Telegram、Feishu 或 QQ account；agent 这里只做 connect。",
    });
    return agent;
  }

  for (const channel of CHAT_CHANNELS) {
    const currentConfig = channelConfigs[channel];
    const currentAccountId = String(currentConfig?.channelAccountId || "").trim();
    const nextAccountId = await promptChannelAccountId({
      channel,
      currentAccountId,
    });
    if (nextAccountId === undefined) {
      emitCliBlock({
        tone: "info",
        title: "Chat platform connection cancelled",
      });
      return agent;
    }
    if (nextAccountId === null) {
      channelConfigs[channel] = {
        enabled: false,
      };
      continue;
    }
    channelConfigs[channel] = {
      enabled: true,
      channelAccountId: nextAccountId,
    };
  }

  write_agent_config(agent.id, nextRaw);
  const nextConfig = readAgentConfig(agent.id);
  const nextAgent = {
    ...agent,
    channels: readAgentChannelSummaries(nextConfig),
  };
  emitCliBlock({
    tone: "success",
    title: "Agent chat platforms connected",
    summary: nextAgent.channels.length > 0 ? nextAgent.channels.join(", ") : "none",
    facts: [
      {
        label: "project",
        value: agent.project_root,
      },
    ],
  });
  return nextAgent;
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
        if (config_action === "connectChatAccounts") {
          agent = await connectAgentChannels(agent);
          last_message = t({
            zh: "Chat 账号连接已更新",
            en: "Chat account bindings updated",
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
