/**
 * ExecutionModelBinding：City 宿主侧 City AIService 模型绑定辅助。
 *
 * 职责说明（中文）
 * - 统一读取 City AIService 模型目录。
 * - 校验 Agent 全局 DB 配置中的 `execution.modelId` 是否能在 City AIService 中找到。
 * - City 只保存 model id，不保存 provider、key 或 endpoint。
 */

import {
  assertCityAiModelReady,
  listCityAiModelChoices,
  type CityAiModelChoice,
} from "@/city/runtime/city-model/CityAiServiceBinding.js";
import { mergeProcessEnvWithPlatformGlobalEnv } from "@/city/env/ProcessEnv.js";
import { readAgentConfig } from "@/city/process/registry/AgentConfigStore.js";

/**
 * City AIService 模型下拉候选项。
 */
export type PlatformModelChoice = CityAiModelChoice;

/**
 * 读取 City AIService 模型候选列表。
 */
export async function listPlatformModelChoices(): Promise<PlatformModelChoice[]> {
  return await listCityAiModelChoices(mergeProcessEnvWithPlatformGlobalEnv());
}

/**
 * 断言指定模型可用于 agent execution。
 */
export async function assertPlatformModelReady(modelId: string): Promise<void> {
  await assertCityAiModelReady(modelId, mergeProcessEnvWithPlatformGlobalEnv());
}

/**
 * 断言项目 execution 绑定已声明且目标模型可用。
 */
export async function assertProjectExecutionModelReady(project_root: string): Promise<void> {
  const config = readAgentConfig(project_root);
  if (!config) {
    throw new Error("Agent config not found in global DB. Run `city agent create` first.");
  }
  const primaryModelId = String(config.execution?.type === "api" ? config.execution.model_id || "" : "").trim();
  if (!primaryModelId) {
    throw new Error(
      'Invalid agent config: "execution" is required and must be { "type": "api", "modelId": "..." }',
    );
  }
  await assertPlatformModelReady(primaryModelId);
}
