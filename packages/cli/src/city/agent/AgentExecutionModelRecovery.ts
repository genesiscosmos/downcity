/** CLI 装配前校验来源明确的模型选择；不可用时交互重选，不隐式跨来源回退。 */
import { same_model } from "@downcity/type";
import prompts from "@/city/tui/Prompts.js";
import { listPlatformModelChoices } from "@/city/runtime/city-model/ExecutionModelBinding.js";
import { ResourceClient } from "../resources/ResourceClient.js";
import type { AgentGetData } from "../resources/ResourceResults.js";
import type { AgentModelSelectionResponse } from "@/city/types/AgentModel.js";
import type { AgentExecutionModelRecoveryDecision, AgentExecutionModelRecoveryInput } from "@/city/types/AgentExecutionModelRecovery.js";

/** 对象按来源与原始模型 ID 比较，持久化前后不依赖对象引用相等。 */
export function resolve_agent_execution_model_recovery(input: AgentExecutionModelRecoveryInput): AgentExecutionModelRecoveryDecision {
  if (!input.available_models.length) return { kind: "unavailable", previous_model: input.configured_model };
  const selected = input.available_models.find((model) => same_model(model, input.configured_model));
  return selected ? { kind: "ready", model: selected } : { kind: "selection_required", previous_model: input.configured_model };
}

/** 启动前要求明确且仍可用的来源。 */
export async function ensure_agent_execution_model_ready(agent_id: string): Promise<void> {
  const client = new ResourceClient();
  const config = ((await client.call("agent.get", { id: agent_id })).data as AgentGetData).agent;
  const choices = await listPlatformModelChoices();
  const decision = resolve_agent_execution_model_recovery({ configured_model: config.model, available_models: choices.map((choice) => choice.value) });
  if (decision.kind === "ready") return;
  if (decision.kind === "unavailable") throw new Error("No chat models are available; check Downtown settings");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Saved model is unavailable; select a model with city agent model");
  const response = await prompts({ type: "select", name: "model", message: "请选择可用的默认模型", choices, initial: 0 }) as AgentModelSelectionResponse;
  if (!response.model) throw new Error("Model selection cancelled");
  await client.call("agent.update", { id: config.agent_id, model: response.model });
}
