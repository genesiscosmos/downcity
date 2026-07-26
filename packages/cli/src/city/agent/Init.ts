/**
 * `city agent create`：创建全局受管 Agent 并绑定一个 Workspace。
 *
 * 目标
 * - 生成 `.agents/skills` 与 `.downcity/` 运行目录
 * - 通过交互式问题收集必要配置（模型、channels 等）
 *
 * 设计要点
 * - Chat channels 支持多选：选择结果写入 CLI 全局 DB 中的 agent 配置
 * - 避免写入无意义的默认值：能省则省，保持配置简洁
 */

import path from "path";
import prompts from "@/city/tui/Prompts.js";
import {
  initialize_agent_project,
  normalize_default_agent_id,
} from "@/city/agent/setup/AgentInitializer.js";
import type { AgentProjectChannel } from "@/city/types/config/AgentProject.js";
import type { ExecutionBindingConfig } from "@/city/types/config/ExecutionBinding.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import {
  assertPlatformModelReady,
  listPlatformModelChoices,
} from "@/city/runtime/city-model/ExecutionModelBinding.js";
import {
  create_managed_agent,
  get_managed_agent,
  save_managed_agent,
} from "@/city/process/registry/ManagedAgentRepository.js";
import { ensure_default_agent_plugin_bindings } from "@/city/process/registry/PluginRepository.js";

type InitPromptResponse = {
  id?: string;
  primaryModelId?: string;
  channels?: string[];
};

type ChatChannelsConfig = Partial<Record<AgentProjectChannel, {
  /** 当前渠道是否启用。 */
  enabled?: boolean;
  /** 绑定的 City chat account id。 */
  channelAccountId?: string;
}>>;


/**
 * init 命令入口。
 *
 * 流程（中文）
 * 1) 校验项目目录与覆盖策略
 * 2) 交互收集配置
 * 3) 生成配置与目录
 * 4) 生成最小可运行结构（skills 目录仅创建，不做自动同步/安装）
 */
export async function initCommand(
  cwd: string = ".",
  options: { force?: boolean } = {},
): Promise<void> {
  const project_root = path.resolve(cwd);
  const projectBaseName = path.basename(project_root);
  const default_agent_id =
    normalize_default_agent_id(projectBaseName) || projectBaseName;
  let allowOverwrite = Boolean(options.force);

  emitCliBlock({
    tone: "accent",
    title: "Initializing agent project",
    facts: [
      {
        label: "Project",
        value: project_root,
      },
    ],
  });

  const modelChoices = await listPlatformModelChoices();
  const modelChoiceIds = modelChoices.map((item) => item.value);
  if (modelChoiceIds.length === 0) {
    throw new CliError({
      title: "City AIService has no available models",
      note: "Please register at least one model in City AIService and ensure the City user token can access it.",
      fix: "city",
    });
  }

  // Collect configuration information
  // 交互采集（中文）：agent id + model + chat platforms。
  const response = (await prompts([
    {
      type: "text",
      name: "id",
      message: "Agent id",
      initial: default_agent_id,
    },
    {
      type: "select",
      name: "primaryModelId",
      message: "Select primary model (from City AIService)",
      choices: modelChoices,
      initial: 0,
    },
    {
      // 关键交互（中文）：Chat platforms 允许多选，未选择的就不写入 DB 配置。
      type: "multiselect",
      name: "channels",
      message: "Select chat platforms (multi-select)",
      choices: [
        { title: "Telegram", value: "telegram" },
        { title: "Feishu", value: "feishu" },
        { title: "QQ", value: "qq" },
      ],
    },
  ])) as InitPromptResponse;

  // 关键点（中文）：agent_id 只写入全局 DB，项目目录不再保存配置副本。
  const agent_id =
    String(response.id || "").trim() || default_agent_id;
  const primaryModelId =
    String(response.primaryModelId || "").trim() || modelChoiceIds[0];
  const execution: ExecutionBindingConfig = {
    type: "api",
    model_id: primaryModelId,
  };
  await assertPlatformModelReady(primaryModelId);
  const selectedChannels = Array.isArray(response.channels)
    ? (response.channels as AgentProjectChannel[])
    : [];
  const channels_config: ChatChannelsConfig = {};
  for (const channel of selectedChannels) {
    channels_config[channel] = { enabled: true };
  }
  const existing_agent = get_managed_agent(agent_id);
  if (existing_agent && !allowOverwrite) {
    const confirm_response = (await prompts({
      type: "confirm",
      name: "overwrite",
      message: `Agent "${agent_id}" already exists. Rebind it to this Workspace and replace its configuration?`,
      initial: false,
    })) as { overwrite?: boolean };
    if (!confirm_response.overwrite) {
      emitCliBlock({
        tone: "info",
        title: "Agent creation cancelled",
      });
      return;
    }
    allowOverwrite = true;
  }
  const initResult = await initialize_agent_project(
    {
      project_root: project_root,
      id: agent_id,
      execution,
      channels: selectedChannels,
    },
  );
  const plugins = Object.keys(channels_config).length > 0
    ? {
        chat: {
          channels: channels_config,
        },
      }
    : undefined;
  if (existing_agent && allowOverwrite) {
    save_managed_agent({
      agent_id,
      workspace_path: project_root,
      version: "1.0.0",
      execution,
      created_at: existing_agent.created_at,
      updated_at: existing_agent.updated_at,
    });
  } else {
    create_managed_agent({
      agent_id,
      workspace_path: project_root,
      execution,
    });
  }
  ensure_default_agent_plugin_bindings(agent_id, {
    ...(plugins?.chat ? { chat: plugins.chat } : {}),
  });

  const createdItems = [
    ...initResult.created_files,
    "global managed agent",
  ];
  const skippedItems = [...initResult.skipped_files];

  emitCliBlock({
    tone: "success",
    title: "Initialization complete",
    summary: agent_id,
  });
  emitCliList({
    tone: "accent",
    title: "Created",
    items: createdItems.map((item) => ({ title: item })),
  });
  emitCliList({
    tone: "info",
    title: "Skipped",
    items: skippedItems.map((item) => ({ title: item })),
  });
  if (primaryModelId) {
    emitCliBlock({
      tone: "info",
      title: "Execution",
      summary: "api",
      facts: [
        {
          label: "Model ID",
          value: primaryModelId,
        },
        {
          label: "Source",
          value: "City AIService",
        },
      ],
    });
  }

  const channelItems: Array<{ title: string; facts: Array<{ label: string; value: string }> }> = [];
  if (selectedChannels.includes("feishu")) {
    channelItems.push({
      title: "feishu",
      facts: [
        {
          label: "Bind",
          value: "plugins.chat.channels.feishu.channelAccountId",
        },
        {
          label: "Manage",
          value: "city chat accounts",
        },
      ],
    });
  }
  if (selectedChannels.includes("telegram")) {
    channelItems.push({
      title: "telegram",
      facts: [
        {
          label: "Bind",
          value: "plugins.chat.channels.telegram.channelAccountId",
        },
        {
          label: "Manage",
          value: "city chat accounts",
        },
      ],
    });
  }
  if (selectedChannels.includes("qq")) {
    channelItems.push({
      title: "qq",
      facts: [
        {
          label: "Bind",
          value: "plugins.chat.channels.qq.channelAccountId",
        },
        {
          label: "Manage",
          value: "city chat accounts",
        },
      ],
    });
  }
  if (channelItems.length > 0) {
    emitCliList({
      tone: "accent",
      title: "Chat platforms",
      items: channelItems,
    });
  }

  const nextSteps: string[] = [
    "Add reusable capabilities under .agents/skills",
    "Use downcity agent model --set <model-id> to update the Agent default model",
  ];
  if (primaryModelId) {
    nextSteps.push('Use "city agent start" to confirm the Agent can reach its configured model');
  }

  if (selectedChannels.includes("telegram")) {
    nextSteps.push(
      "Bind plugins.chat.channels.telegram.channelAccountId to an existing chat account",
    );
  }
  if (selectedChannels.includes("feishu")) {
    nextSteps.push(
      "Bind plugins.chat.channels.feishu.channelAccountId to an existing chat account",
    );
  }
  if (selectedChannels.includes("qq")) {
    nextSteps.push(
      "Bind plugins.chat.channels.qq.channelAccountId to an existing chat account",
    );
  }
  nextSteps.push('Run "city agent start" to start the agent');

  emitCliList({
    tone: "accent",
    title: "Next steps",
    items: nextSteps.map((line, idx) => ({
      title: `${idx + 1}. ${line}`,
    })),
  });
  emitCliBlock({
    tone: "info",
    title: "Tip",
  });
}
