/** CLI 默认模型选择；交互值使用结构化引用，裸模型名仅在目录中唯一时接受。 */
import { same_model } from "@downcity/type";
import prompts from "@/city/tui/Prompts.js";
import { listPlatformModelChoices, resolve_platform_model_selection } from "@/city/runtime/city-model/ExecutionModelBinding.js";
import { ResourceClient } from "../resources/ResourceClient.js";
import type { AgentGetData } from "../resources/ResourceResults.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import type { AgentModelCommandOptions, AgentModelConfigurationResult, AgentModelSelectionResponse } from "@/city/types/AgentModel.js";

/** 用户选择只改变默认配置，不覆盖已有 Session 的模型快照。 */
export async function configure_agent_model(agent_id: string, options: AgentModelCommandOptions = {}): Promise<AgentModelConfigurationResult | null> {
  const client = new ResourceClient();
  const agent = ((await client.call("agent.get", { id: agent_id })).data as AgentGetData).agent;
  const choices = await listPlatformModelChoices();
  if (!choices.length) throw new Error("No chat models are available");
  const response = options.set ? { model: await resolve_platform_model_selection(options.set) }
    : process.stdin.isTTY && process.stdout.isTTY ? await prompts({ type: "select", name: "model", message: "选择 Agent 默认模型", choices,
      initial: Math.max(0, choices.findIndex((choice) => same_model(choice.value, agent.model))) }) as AgentModelSelectionResponse : undefined;
  if (!response?.model) return null;
  await client.call("agent.update", { id: agent.agent_id, model: response.model });
  const result = { agent_id: agent.agent_id, previous_model: agent.model, current_model: response.model, changed: !same_model(agent.model, response.model) };
  emitCliBlock({ tone: result.changed ? "success" : "info", title: "Agent default model configured", summary: agent.agent_id,
    facts: [{ label: "model", value: choices.find((choice) => same_model(choice.value, response.model))?.title ?? response.model.id }, { label: "effective", value: "new Sessions" }] });
  return result;
}
