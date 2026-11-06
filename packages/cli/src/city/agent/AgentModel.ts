/**
 * Agent 默认模型配置服务。
 *
 * 关键点（中文）
 * - 模型候选项唯一来源是当前 Federation User City 的 `ai.catalog()`。
 * - 通过共用资源客户端更新 `execution.model_id`，不改已有 Session 覆盖。
 * - 在线由当前宿主解析/应用，离线只保存配置。
 */

import prompts from "@/city/tui/Prompts.js";
import { listPlatformModelChoices } from "@/city/runtime/city-model/ExecutionModelBinding.js";
import type { AgentGetData } from "../resources/ResourceResults.js";
import { ResourceClient } from "../resources/ResourceClient.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import type {
  AgentModelCommandOptions,
  AgentModelConfigurationResult,
  AgentModelSelectionResponse,
} from "@/city/types/AgentModel.js";

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
        fix: `city agent update ${params.agent_id} --model <model-id>`,
      });
    }
    return requested_model_id;
  }
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new CliError({
      title: "Model id is required in non-interactive mode",
      fix: `city agent update ${params.agent_id} --model <model-id>`,
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

/** 配置 Agent 默认模型。 */
export async function configure_agent_model(
  agent_id_input: string,
  options: AgentModelCommandOptions = {},
): Promise<AgentModelConfigurationResult | null> {
  const client = new ResourceClient();
  const detail = await client.call("agent.get", { id: agent_id_input });
  const agent = (detail.data as AgentGetData).agent;
  const previous_model_id = agent.model_id ?? "";
  const selected_model_id = await resolve_model_id({
    current_model_id: previous_model_id,
    requested_model_id: options.set,
    agent_id: agent.agent_id,
  });
  if (!selected_model_id) return null;

  const changed = selected_model_id !== previous_model_id;
  await client.call("agent.update", { id: agent.agent_id, model: selected_model_id });

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
      { label: "effective", value: "new Sessions" },
    ],
  });
  return result;
}
