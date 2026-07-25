/**
 * Agent 启动模型恢复。
 *
 * 关键点（中文）
 * - 已保存模型不在当前 Federation 时，TTY 直接展示当前模型选择器。
 * - 选择完成后更新 Agent 默认模型，并让原 start/restart 流程继续执行。
 * - 非交互模式不做隐式选择，返回包含可用模型和修复命令的 CliError。
 */

import prompts from "@/city/tui/Prompts.js";
import { t } from "@/shared/CliLocale.js";
import { CliError } from "@/shared/CliError.js";
import { listPlatformModelChoices } from "@/city/runtime/city-model/ExecutionModelBinding.js";
import {
  get_managed_agent,
  update_managed_agent,
} from "@/city/process/registry/ManagedAgentRepository.js";
import type { AgentModelSelectionResponse } from "@/city/types/AgentModel.js";
import type {
  AgentExecutionModelRecoveryDecision,
  AgentExecutionModelRecoveryInput,
} from "@/city/types/AgentExecutionModelRecovery.js";

/** 根据已保存模型和当前 Federation 目录生成恢复决策。 */
export function resolve_agent_execution_model_recovery(
  input: AgentExecutionModelRecoveryInput,
): AgentExecutionModelRecoveryDecision {
  const configured_model_id = String(input.configured_model_id || "").trim();
  const available_model_ids = [...new Set(
    (input.available_model_ids || [])
      .map((model_id) => String(model_id || "").trim())
      .filter(Boolean),
  )];
  if (available_model_ids.length === 0) {
    return {
      kind: "unavailable",
      previous_model_id: configured_model_id,
    };
  }
  if (configured_model_id && available_model_ids.includes(configured_model_id)) {
    return {
      kind: "ready",
      model_id: configured_model_id,
    };
  }
  return {
    kind: "selection_required",
    previous_model_id: configured_model_id,
  };
}

/** 构建非交互模式下可直接执行的模型修复命令。 */
function build_model_recovery_command(
  agent_id: string,
  model_id: string,
): string {
  return `city agent model ${JSON.stringify(agent_id)} --set ${JSON.stringify(model_id)}`;
}

/** 确保受管 Agent 的默认模型可以在当前 Federation 中解析。 */
export async function ensure_agent_execution_model_ready(
  agent_id_input: string,
): Promise<void> {
  const agent_id = String(agent_id_input || "").trim();
  const config = get_managed_agent(agent_id);
  if (!config) {
    throw new CliError({
      title: "Agent config not found",
      note: `agent: ${agent_id}`,
      fix: "city agent list",
    });
  }

  const configured_model_id = String(
    config.execution?.type === "api" ? config.execution.model_id || "" : "",
  ).trim();
  const choices = await listPlatformModelChoices();
  const decision = resolve_agent_execution_model_recovery({
    configured_model_id,
    available_model_ids: choices.map((choice) => choice.value),
  });
  if (decision.kind === "ready") return;
  if (decision.kind === "unavailable") {
    throw new CliError({
      title: "No models available in current Federation",
      note: decision.previous_model_id
        ? `Configured model is unavailable: ${decision.previous_model_id}`
        : "Agent has no execution model and the current Federation exposes no compatible models.",
      fix: "city federation status",
    });
  }

  const available_model_ids = choices.map((choice) => choice.value);
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new CliError({
      title: "Agent execution model is unavailable in current Federation",
      note: [
        `configured: ${decision.previous_model_id || "(not configured)"}`,
        `available: ${available_model_ids.join(", ")}`,
      ].join("\n"),
      fix: build_model_recovery_command(agent_id, available_model_ids[0]),
    });
  }

  const response = (await prompts({
    type: "select",
    name: "model_id",
    message: t({
      zh: decision.previous_model_id
        ? `模型 ${decision.previous_model_id} 在当前 Federation 不可用，请重新选择`
        : "当前 Agent 没有可用模型，请从当前 Federation 选择",
      en: decision.previous_model_id
        ? `Model ${decision.previous_model_id} is unavailable in the current Federation. Select another model`
        : "This Agent has no available model. Select one from the current Federation",
    }),
    choices,
    initial: 0,
  })) as AgentModelSelectionResponse;
  const selected_model_id = String(response.model_id || "").trim();
  if (!selected_model_id) {
    throw new CliError({
      title: "Agent model selection cancelled",
      note: "Agent start was not changed or continued.",
    });
  }

  update_managed_agent({
    agent_id: config.agent_id,
    execution: {
      type: "api",
      model_id: selected_model_id,
    },
  });
}
