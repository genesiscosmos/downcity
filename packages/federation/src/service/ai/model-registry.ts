/**
 * AI 模型注册表模块。
 *
 * 负责模型注册校验、环境可用性判断和公开模型目录投影。
 * AIService 保留请求编排职责，不直接维护模型 Map 和目录序列化细节。
 */

import type {
  AIModelEnvRequirement,
  AIModelDefinition,
} from "../../types/AI.js";
import type { CityModelDescriptor } from "@downcity/type";
import type { ModelPricing } from "@downcity/type";
import { validate_model_context_window } from "./model-context-window.js";
import { validate_model_reasoning } from "./reasoning.js";

/** 模型环境变量读取函数。 */
type EnvReader = (key: string) => string | undefined;

/** 公开模型目录查询选项。 */
interface ModelCatalogOptions {
  /** 当前请求可读取的环境变量。 */
  env: EnvReader;
  /** 当前请求身份，决定是否返回管理字段。 */
  identity: "guest" | "user" | "bureau" | "admin";
  /** 根据运行时 action 计算模型公开模态。 */
  get_modalities: (model: AIModelDefinition) => string[];
}

/** AIService 使用的模型注册表。 */
export class AIModelRegistry {
  /** 按模型 ID 保存运行时配置。 */
  private readonly model_map = new Map<string, AIModelDefinition>();

  /** 注册一个或多个模型配置。 */
  register(...inputs: (AIModelDefinition | AIModelDefinition[])[]): void {
    const configs = inputs.flatMap((input) => Array.isArray(input) ? input : [input]);
    for (const config of configs) {
      if (this.model_map.has(config.id)) {
        throw new Error(`Duplicate model: ${config.id}`);
      }
      validate_model_context_window(config);
      validate_model_reasoning(config);
      validate_model_pricing(config.pricing);
      this.model_map.set(config.id, config);
    }
  }

  /** 判断注册表是否包含模型。 */
  get size(): number {
    return this.model_map.size;
  }

  /** 按 ID 读取运行时模型配置。 */
  get(model_id: string): AIModelDefinition | undefined {
    return this.model_map.get(model_id);
  }

  /** 返回全部运行时模型配置。 */
  list(): AIModelDefinition[] {
    return [...this.model_map.values()];
  }

  /** 返回模型缺失的必填环境变量 key。 */
  get_missing_env(model: AIModelDefinition, env: EnvReader): string[] {
    return this.get_env_requirements(model)
      .filter((item) => item.required && !env(item.key))
      .map((item) => item.key);
  }

  /** 按身份和环境可用性生成公开模型目录。 */
  list_public(options: ModelCatalogOptions): CityModelDescriptor[] {
    const include_admin_fields = options.identity === "admin";
    const configs = include_admin_fields
      ? this.list()
      : this.list().filter((model) => this.get_missing_env(model, options.env).length === 0);

    return configs.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description ?? "",
      ...(model.context_window !== undefined
        ? { context_window: model.context_window }
        : {}),
      modalities: options.get_modalities(model),
      tags: model.tags ?? [],
      ...(model.pricing ? { pricing: clone_pricing(model.pricing) } : {}),
      ...(model.pricing
        ? { price: pricing_to_legacy_price(model.pricing) }
        : model.price ? { price: [...model.price] } : {}),
      meta: model.meta ?? {},
      ...(model.reasoning ? { reasoning: model.reasoning } : {}),
      ...(include_admin_fields
        ? { env_requirements: this.get_env_requirements(model) }
        : {}),
    }));
  }

  /** 将模型环境配置转换为公开需求列表。 */
  private get_env_requirements(model: AIModelDefinition): AIModelEnvRequirement[] {
    const requirements = model.env ? Object.entries(model.env) : [];

    return requirements.map(([key, description]) => ({
      key,
      description,
      required: true,
    }));
  }
}

/** 校验结构化价格，尽早拒绝无法用于目录或计费的配置。 */
function validate_model_pricing(pricing: AIModelDefinition["pricing"]): void {
  if (!pricing) return;
  const values: ModelPricing[] = pricing ? (Array.isArray(pricing) ? pricing : [pricing]) : [];
  for (const item of values) {
    if (!item.currency.trim() || !item.unit.trim()) throw new Error("Model pricing currency and unit are required");
    if (item.scale !== undefined && (!Number.isFinite(item.scale) || item.scale <= 0)) throw new Error("Model pricing scale must be positive");
    for (const [key, value] of Object.entries(item.rates)) {
      if (!key.trim() || !Number.isFinite(value) || value < 0) throw new Error("Model pricing rates must be non-negative finite numbers");
    }
    if (item.dimensions && Object.values(item.dimensions).some((value) => typeof value !== "string")) throw new Error("Model pricing dimensions must be strings");
  }
}

/** 复制公开价格，避免目录调用方修改注册表中的事实源。 */
function clone_pricing(pricing: AIModelDefinition["pricing"]): ModelPricing[] {
  const values: ModelPricing[] = pricing ? (Array.isArray(pricing) ? pricing : [pricing]) : [];
  return values.map((item) => ({
    ...item,
    rates: { ...item.rates },
    ...(item.dimensions ? { dimensions: { ...item.dimensions } } : {}),
  }));
}

/** 为旧客户端生成稳定、可读且不参与计费的兼容文案。 */
function pricing_to_legacy_price(pricing: NonNullable<AIModelDefinition["pricing"]>): string[] {
  return (Array.isArray(pricing) ? pricing : [pricing]).map((item) => {
    const scale = item.scale ? ` / ${item.scale} ${item.unit}` : ` / ${item.unit}`;
    const rates = Object.entries(item.rates).map(([key, value]) => `${key}=${value}`).join(", ");
    const dimensions = item.dimensions ? ` (${Object.entries(item.dimensions).map(([key, value]) => `${key}=${value}`).join(", ")})` : "";
    return `${item.currency}${scale}: ${rates}${dimensions}`;
  });
}
