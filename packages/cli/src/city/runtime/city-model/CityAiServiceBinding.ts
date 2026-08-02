/**
 * City 侧 City AIService 绑定模块。
 *
 * 关键点（中文）
 * - City 不拥有模型池，也不解析 provider / apiKey / baseURL。
 * - 模型目录唯一来源是 City 的 AIService：`/v1/ai/models`。
 * - 运行时模型通过 City 自己保存的 User City session 构造。
 */

import { FederationAdmin } from "@downcity/city";
import type { AgentModel } from "@downcity/agent";
import type { CityModelDescriptor } from "@downcity/type";
import { CityUserManager } from "@/city/shared/CityUserManager.js";

const cityUserManager = new CityUserManager();
const agent_execution_modalities = new Set(["text", "stream", "openai"]);

/**
 * City AIService 模型选项。
 */
export interface CityAiModelChoice {
  /**
   * CLI 选择器展示文案。
   */
  title: string;

  /**
   * 写入 Agent 配置 `execution.modelId` 的模型 ID。
   */
  value: string;

  /**
   * 原始 City 模型目录项。
   */
  model: CityModelDescriptor;
}

/**
 * 读取管理端模型目录。
 */
export async function listCityAiServiceModelsForAdmin(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CityModelDescriptor[]> {
  const user = await cityUserManager.resolveCurrentUser({
    env,
    require_user_token: false,
    verify_user: false,
  });
  const admin_secret_key = cityUserManager.readAdminSecret(user.federation_url, env);
  if (!admin_secret_key) {
    throw new Error(
      "City admin_secret_key is required to list models. Set DOWNCITY_CITY_ADMIN_SECRET_KEY or configure admin access with `city`.",
    );
  }
  const admin = new FederationAdmin({
    base_url: user.federation_url,
    credential: admin_secret_key,
  });
  return await admin.listModels();
}

/**
 * 读取用户态可调用模型目录。
 */
export async function listCityAiServiceModelsForUser(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CityModelDescriptor[]> {
  const { city } = await cityUserManager.createUserClient({
    env,
  });
  const catalog = await city.ai.catalog();
  return catalog.all();
}

/**
 * 构建 City AIService 模型选择项。
 */
export function toCityAiModelChoices(models: CityModelDescriptor[]): CityAiModelChoice[] {
  return models.filter(is_city_ai_execution_model).map((model) => ({
    title: [
      model.id,
      model.name && model.name !== model.id ? `· ${model.name}` : "",
      model.modalities.length > 0 ? `· ${model.modalities.join("/")}` : "",
    ].filter(Boolean).join(" "),
    value: model.id,
    model,
  }));
}

/** 判断 Federation 模型是否能作为 Agent 的对话执行模型。 */
export function is_city_ai_execution_model(model: CityModelDescriptor): boolean {
  return model.modalities.some((modality) =>
    agent_execution_modalities.has(String(modality || "").trim()),
  );
}

/**
 * 读取可供 City 绑定的 City AIService 模型选项。
 */
export async function listCityAiModelChoices(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CityAiModelChoice[]> {
  const models = await listCityAiServiceModelsForUser(env);
  return toCityAiModelChoices(models);
}

/**
 * 断言 City AIService 暴露了指定 model。
 */
export async function assertCityAiModelReady(
  modelId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const id = String(modelId || "").trim();
  if (!id) throw new Error("execution.modelId is required");
  const models = await listCityAiServiceModelsForUser(env);
  if (!models.some((model) => model.id === id && is_city_ai_execution_model(model))) {
    throw new Error(`Agent execution model not found in Federation: ${id}`);
  }
}

/**
 * 创建 Agent 可直接使用的 City 模型。
 */
export async function createCityAiAgentModel(input: {
  /**
   * 目标 City AIService model id。
   */
  modelId: string;

  /**
   * 宿主环境变量。
   */
  env?: NodeJS.ProcessEnv;
}): Promise<AgentModel> {
  const modelId = String(input.modelId || "").trim();
  if (!modelId) throw new Error("modelId cannot be empty");
  const { city } = await cityUserManager.createUserClient({
    env: input.env ?? process.env,
  });
  const catalog = await city.ai.catalog();
  const model = catalog.get(modelId);
  if (!model || !is_city_ai_execution_model(model)) {
    throw new Error(`Agent execution model not found in Federation: ${modelId}`);
  }
  return model;
}
