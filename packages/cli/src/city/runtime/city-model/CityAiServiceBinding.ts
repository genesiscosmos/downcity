/**
 * City 侧 City AIService 绑定模块。
 *
 * 关键点（中文）
 * - City 不拥有模型池，也不解析 provider / apiKey / baseURL。
 * - 模型目录唯一来源是 City 的 AIService：`/v1/ai/models`。
 * - 运行时模型只消费宿主显式传入的当前 City Federation 绑定。
 */

import { Federation } from "@downcity/federation";
import { resolve_local_city_id, resolve_resource_root } from "@downcity/city/local";
import type { CityModelDescriptor, ModelClient } from "@downcity/type";
import { FederationSessionResolver } from "@/city/shared/FederationSessionResolver.js";

const federation_session_resolver = new FederationSessionResolver();
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
  const user = await federation_session_resolver.resolve_current_user({
    env,
    require_user_token: false,
    verify_user: false,
  });
  const admin_session_token = federation_session_resolver.read_admin_session(user.federation_url);
  if (!admin_session_token) {
    throw new Error(
      "A valid Federation administrator session is required to list admin models. Log in with `fed manage`.",
    );
  }
  const admin = new Federation({
    url: user.federation_url,
    admin_token: admin_session_token,
  }).admin;
  return await admin.list_models();
}

/**
 * 读取用户态可调用模型目录。
 */
export async function listCityAiServiceModelsForUser(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CityModelDescriptor[]> {
  const { federation_user } = await federation_session_resolver.create_user_client({
    env,
  });
  const catalog = await federation_user.with_city(resolve_local_city_id(resolve_resource_root())).ai.catalog();
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
export async function create_city_ai_model_client(input: {
  /** 目标 Federation 模型 ID。 */
  model_id: string;
  /** 请求开始时读取的 City 当前绑定；缺少绑定时明确失败。 */
  federation: Federation | undefined;
}): Promise<ModelClient> {
  const model_id = String(input.model_id || "").trim();
  if (!model_id) throw new Error("model_id cannot be empty");
  if (!input.federation) {
    throw new Error("City has no Federation binding. Log in and bind a Federation before using models.");
  }
  const catalog = await input.federation.user.with_city(resolve_local_city_id(resolve_resource_root())).ai.catalog();
  const model = catalog.get(model_id);
  if (!model || !is_city_ai_execution_model(model)) {
    throw new Error(`Agent execution model not found in Federation: ${model_id}`);
  }
  return model;
}
