/**
 * City 模型公共协议模块。
 *
 * 该模块定义跨 package 共享的模型目录与可执行 LanguageModelV3 协议。
 * 具体的 HTTP transport 由 @downcity/city 内部实现，Agent 只依赖标准模型接口。
 */

import type { LanguageModel } from "ai";

/** City model 的公开协议标识。 */
export const CITY_MODEL_KIND = "downcity.city-model" as const;

/** City 模型依赖的环境变量需求。 */
export interface CityModelEnvRequirement {
  /** 环境变量 key，例如 `OPENAI_API_KEY`。 */
  key: string;
  /** 给管理员展示的说明文本。 */
  description: string;
  /** 当前环境变量是否为调用该模型的必填项。 */
  required: boolean;
}

/** 模型公开支持的单个推理强度档位。 */
export interface CityModelReasoningEffort {
  /** 档位唯一 ID，同时也是请求 `reasoning_effort` 使用的值。 */
  id: string;
  /** 面向用户展示的档位名称。 */
  name: string;
  /** 面向用户展示的档位说明。 */
  description?: string;
}

/** 模型公开的推理能力配置。 */
export interface CityModelReasoning {
  /** 模型支持的推理强度档位，数组顺序即前端展示顺序。 */
  efforts: CityModelReasoningEffort[];
  /** 请求未指定 `reasoning_effort` 时使用的默认档位 ID。 */
  default_effort?: string;
}

/** 模型的结构化价格方案。 */
export interface ModelPricing {
  /** ISO 4217 货币代码，例如 USD 或 CNY。 */
  currency: string;
  /** 计费对象，例如 token、request 或 image。 */
  unit: "token" | "request" | "image" | string;
  /** 每个价格对应的计费单位数量；token 通常为 1_000_000。 */
  scale?: number;
  /** 命名计费组件，例如 input、output 或 cached_input。 */
  rates: Record<string, number>;
  /** 价格适用条件，例如时段、分辨率或上下文档位。 */
  dimensions?: Record<string, string>;
}

/** City 模型目录中的公开模型信息。 */
export interface CityModelDescriptor {
  /** 模型唯一 ID，用于请求 City AIService。 */
  id: string;
  /** 模型展示名称，用于 Console、文档或产品 UI。 */
  name: string;
  /** 模型说明文本。 */
  description: string;
  /** 模型支持的总上下文窗口长度，单位为 token。 */
  context_window?: number;
  /** 该模型支持的能力列表，例如 `text`、`stream`、`image`。 */
  modalities: string[];
  /** 用于筛选或展示的模型标签。 */
  tags: string[];
  /** 结构化价格方案；多个方案用于表达条件、时段或档位差异。 */
  pricing?: ModelPricing | ModelPricing[];
  /** 兼容旧客户端的价格说明列表，由 pricing 派生。 */
  price?: string[];
  /** 模型元数据，供宿主记录 provider、区域、套餐等扩展信息。 */
  meta: Record<string, unknown>;
  /** 模型公开的推理能力；未声明时表示不接受 `reasoning_effort`。 */
  reasoning?: CityModelReasoning;
  /**
   * 模型依赖的环境变量需求。
   *
   * 通常只在 admin 身份下返回，user 身份下可能不存在该字段。
   */
  env_requirements?: CityModelEnvRequirement[];
}

/** 从 AI SDK 公共模型联合类型中提取 LanguageModelV3。 */
type LanguageModelV3 = Extract<
  LanguageModel,
  { readonly specificationVersion: "v3" }
>;

/**
 * 可执行 City 模型。
 *
 * 目录字段用于展示和上下文管理，LanguageModelV3 能力由 CityModel class 实现。
 */
export type CityModel = CityModelDescriptor & LanguageModelV3 & {
  /** City model 协议标识。 */
  readonly kind: typeof CITY_MODEL_KIND;
};

/** 判断输入值是否实现 CityModel 协议。 */
export function isCityModel(value: unknown): value is CityModel {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<PropertyKey, unknown>;
  return (
    record.kind === CITY_MODEL_KIND &&
    typeof record.id === "string" &&
    record.specificationVersion === "v3" &&
    typeof record.doStream === "function" &&
    typeof record.doGenerate === "function"
  );
}
