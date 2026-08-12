/**
 * Agent 默认模型配置服务。
 *
 * 关键点（中文）
 * - 模型候选项唯一来源是当前 Federation User City 的 `ai.catalog()`。
 * - 只维护 Agent 配置中的 `execution.modelId`，不管理 Session 运行时模型。
 * - 配置更新在 Agent 下次启动或重启时解析为运行时模型实例。
 */

import prompts from "@/city/tui/Prompts.js";
import { listPlatformModelChoices } from "@/city/runtime/city-model/ExecutionModelBinding.js";
import {
  get_managed_agent,
  update_managed_agent,
} from "@/city/process/registry/ManagedAgentRepository.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import type {
  AgentModelAgentTarget,
  AgentModelCommandOptions,
  AgentModelConfigurationResult,
  AgentModelSelectionResponse,
} from "@/city/types/AgentModel.js";

/** 解析已登记的目标 Agent，不要求 daemon 正在运行。 */
function resolve_agent_target(agent_id: string): AgentModelAgentTarget {
  const agent = get_managed_agent(agent_id);
  if (!agent) {
    throw new CliError({
      title: "Agent is not registered",
      note: `agent: ${agent_id}`,
      fix: "city agent list",
    });
  }
  return {
    agent_id: agent.agent_id,
  };
}

/** 从 Federation 目录选择或校验 Agent 默认模型。 */
async function resolve_model_id(params: {
  /** 当前 Agent 默认模型 ID。 */
  current_model_id: string;
  /** 命令显式传入的 Federation 模型 ID。 */
  requested_model_id?: string;
  /** 目标 Agent ID。 */
  agent_id: string;
}): Promise<string | null> {
  const choices = await listPlatformModelChoices();
  if (choices.length === 0) {
    throw new CliError({
      title: "No models available in Federation",
      note: "请确认当前 Federation 已发布可用于对话的 AI models，且登录用户有权调用。",
      fix: "downcity federation status",
    });
  }

  const requested_model_id = String(params.requested_model_id || "").trim();
  if (requested_model_id) {
    if (!choices.some((choice) => choice.value === requested_model_id)) {
      throw new CliError({
        title: `Model not available: ${requested_model_id}`,
        note: "目标模型不在当前 Federation User City 返回的对话模型中。",
        fix: `city agent model ${params.agent_id} --set <model-id>`,
      });
    }
    return requested_model_id;
  }
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new CliError({
      title: "Model id is required in non-interactive mode",
      fix: `city agent model ${params.agent_id} --set <model-id>`,
    });
  }

  const initial = Math.max(
    0,
    choices.findIndex((choice) => choice.value === params.current_model_id),
  );
  const response = (await prompts({
    type: "select",
    name: "model_id",
    message: "选择 Agent 默认模型",
    choices,
    initial,
  })) as AgentModelSelectionResponse;
  return String(response.model_id || "").trim() || null;
}

/** 读取 Agent 当前默认模型 ID。 */
function read_agent_default_model_id(agent_id: string): string {
  const config = get_managed_agent(agent_id);
  return String(
    config?.execution?.type === "api" ? config.execution.model_id || "" : "",
  ).trim();
}

/** 写入 Agent 默认模型 ID。 */
function update_agent_default_model(
  agent_id: string,
  model_id: string,
): void {
  const agent = get_managed_agent(agent_id);
  if (!agent) throw new Error(`Agent not found: ${agent_id}`);
  update_managed_agent({
    agent_id: agent.agent_id,
    execution: {
      type: "api",
      model_id,
    },
  });
}

/** 配置 Agent 默认模型。 */
export async function configure_agent_model(
  agent_id_input: string,
  options: AgentModelCommandOptions = {},
): Promise<AgentModelConfigurationResult | null> {
  const agent = resolve_agent_target(agent_id_input);
  const config = get_managed_agent(agent.agent_id);
  if (!config) throw new Error(`Agent not found: ${agent.agent_id}`);
  const previous_model_id = read_agent_default_model_id(agent.agent_id);
  const selected_model_id = await resolve_model_id({
    current_model_id: previous_model_id,
    requested_model_id: options.set,
    agent_id: agent.agent_id,
  });
  if (!selected_model_id) return null;

  const changed = selected_model_id !== previous_model_id;
  if (changed) update_agent_default_model(agent.agent_id, selected_model_id);

  const result: AgentModelConfigurationResult = {
    agent_id: agent.agent_id,
    previous_model_id,
    current_model_id: selected_model_id,
    changed,
  };
  emitCliBlock({
    tone: changed ? "success" : "info",
    title: changed ? "Agent default model updated" : "Agent default model unchanged",
    summary: result.agent_id,
    facts: [
      { label: "previous", value: result.previous_model_id || "(not configured)" },
      { label: "current", value: result.current_model_id },
      { label: "effective", value: "next start/restart" },
    ],
  });
  return result;
}
