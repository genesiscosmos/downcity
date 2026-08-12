/**
 * `city agent create`：创建全局受管 Agent 并绑定一个 Workspace。
 *
 * 目标
 * - 生成 `.agents/skills` 与 `.downcity/` 运行目录
 * - 通过交互式问题收集 Agent 身份与默认模型
 *
 * 设计要点
 * - Plugin 配置统一通过 Agent Plugin 管理器完成，创建流程不识别具体 Plugin
 * - 避免写入无意义的默认值：能省则省，保持配置简洁
 */

import path from "path";
import prompts from "@/city/tui/Prompts.js";
import {
  initialize_agent_project,
  normalize_default_agent_id,
} from "@/city/agent/setup/AgentInitializer.js";
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
import { select_agent_create_workspace } from "@/city/agent/create/AgentCreateWorkspace.js";
import { create_workspace } from "@/city/process/registry/WorkspaceRepository.js";

type InitPromptResponse = {
  id?: string;
  primaryModelId?: string;
};


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
  cwd: string,
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
  // 交互采集（中文）：Agent 创建只收集稳定身份与默认模型。
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
  const existing_agent = get_managed_agent(agent_id);
  if (existing_agent && !allowOverwrite) {
    const confirm_response = (await prompts({
      type: "confirm",
      name: "overwrite",
      message: `Agent "${agent_id}" already exists. Replace its configuration?`,
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
    },
  );
  const workspace_record = create_workspace({ workspace_path: project_root });
  if (existing_agent && allowOverwrite) {
    save_managed_agent({
      agent_id,
      workspace_id: workspace_record.workspace_id,
      version: "1.0.0",
      execution,
      created_at: existing_agent.created_at,
      updated_at: existing_agent.updated_at,
    });
  } else {
    create_managed_agent({
      agent_id,
      workspace_id: workspace_record.workspace_id,
      execution,
    });
  }
  const createdItems = [
    ...initResult.created_files,
    "global managed agent",
    "registered Workspace",
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

  const nextSteps: string[] = [
    "Add reusable capabilities under .agents/skills",
    "Use downcity agent model --set <model-id> to update the Agent default model",
    "Open Agent Config > Plugins to configure built-in or installed Plugins",
  ];
  if (primaryModelId) {
    nextSteps.push('Use "city agent start" to confirm the Agent can reach its configured model');
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

/**
 * 统一执行命令行与 Agent Manager 的创建流程。
 *
 * 显式路径直接使用；没有路径参数时才允许用户选择当前目录或打开系统文件夹窗口。
 */
export async function run_agent_create_command(
  path_argument: string | undefined,
  options: { force?: boolean } = {},
): Promise<void> {
  const project_root = await select_agent_create_workspace(path_argument);
  if (!project_root) {
    emitCliBlock({
      tone: "info",
      title: "Agent creation cancelled",
    });
    return;
  }
  await initCommand(project_root, options);
}
