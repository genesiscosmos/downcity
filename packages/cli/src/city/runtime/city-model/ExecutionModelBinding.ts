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
