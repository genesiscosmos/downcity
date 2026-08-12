/**
 * CreateRuntimeModel：City 宿主侧模型工厂。
 *
 * 关键点（中文）
 * - City 不再实现 provider/model 模型池。
 * - `execution.modelId` 只表示 City AIService 中暴露的 model id。
 * - 真实 provider、密钥、endpoint 与模型实现都由 City 的 AIService 负责。
 */

import { get_logger } from "@downcity/agent";
import type { AgentModel } from "@downcity/agent";
import { createCityAiAgentModel } from "@/city/runtime/city-model/CityAiServiceBinding.js";
import type { ManagedAgent } from "@/city/types/agent/ManagedAgent.js";

type RuntimeModelFactoryInput = {
  /**
   * 当前 agent 配置。
   *
   * 关键点（中文）
   * - 这里只读取 `execution.modelId`。
   * - 模型能力目录来自 City AIService。
   */
  config: ManagedAgent;

  /**
   * 宿主显式注入的运行时 env。
   *
   * 关键点（中文）
   * - 用于读取 DOWNCITY_FEDERATION_URL / DOWNCITY_USER_TOKEN 覆盖项。
   * - 未显式覆盖时回退到 `city federation login` 保存的 Embassy Session。
   * - 不再读取 provider API Key。
   */
  env?: Record<string, string> | NodeJS.ProcessEnv;
};

function normalizeRuntimeEnv(
  env: Record<string, string> | NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = {};
  if (!env) return resolved;
  for (const [key, value] of Object.entries(env)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || value === undefined || value === null) continue;
    resolved[normalizedKey] = String(value);
  }
  return resolved;
}

function readProjectExecutionBinding(
  config: ManagedAgent,
): { type: "api"; modelId: string } | null {
  const execution = config.execution;
  if (!execution || typeof execution !== "object") return null;
  if (execution.type !== "api") return null;
  const modelId = String(execution.model_id || "").trim();
  if (!modelId) return null;
  return {
    type: "api",
    modelId,
  };
}

/**
 * 创建 Agent 可直接使用的模型实例。
 */
export async function createRuntimeModel(
  input: RuntimeModelFactoryInput,
): Promise<AgentModel> {
  const logger = get_logger();
  const execution = readProjectExecutionBinding(input.config);
  if (!execution) {
    await logger.log("warn", "No agent execution configured");
    throw new Error("No agent execution configured");
  }

  const model = await createCityAiAgentModel({
    modelId: execution.modelId,
    env: normalizeRuntimeEnv(input.env),
  });

  await logger.log(
    "info",
    `[city] city ai model ready: ${execution.modelId}`,
    {
      kind: "city_ai_model_ready",
      modelId: execution.modelId,
    },
  );

  return model;
}
