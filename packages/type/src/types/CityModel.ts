/**
 * City 模型公共协议模块。
 *
 * 该模块定义跨 package 共享的模型目录与可执行 Downcity Model Protocol。
 * 具体 HTTP transport 由 @downcity/downtown 客户端实现。
 */

import type { ModelClient } from "./model/ModelClient.js";

/** City model 的公开协议标识。 */
export const CITY_MODEL_KIND = "downcity.city-model" as const;

/**
 * 由 Town 管理的 Downtown 模型引用。
 *
 * Agent、Session 和委派只保存这两个字段；模型服务内的模型 ID 不再和
 * 来源 ID 拼成一个需要解析的字符串。
 */
export interface DowntownModelReference {
  /** Town 中登记的 Downtown 稳定标识。 */
  downtown: string;
  /** 目标 Downtown 服务声明的原始模型 ID。 */
  id: string;
}

/** 宿主或扩展直接提供的模型引用，不借用 Downtown 命名空间。 */
export interface ClientModelReference {
  /** 宿主登记的直接客户端来源 ID。 */
  client: string;
  /** 客户端原始模型 ID。 */
  id: string;
}

/** 业务配置只保存结构化来源与原始模型 ID，不保存编码目录键。 */
export type ModelReference = DowntownModelReference | ClientModelReference;

/** 校验完整的 Downtown 模型引用。 */
export function is_downtown_model_reference(value: unknown): value is DowntownModelReference {
  return is_model_reference(value) && "downtown" in value;
}

/** 校验来源互斥且字段完整的模型引用。 */
export function is_model_reference(value: unknown): value is ModelReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const text = (item: unknown) => typeof item === "string" && item.length > 0 && item === item.trim();
  return text(record.id) && ((text(record.downtown) && !("client" in record))
    || (text(record.client) && !("downtown" in record)));
}

/** 值比较用于持久化恢复和选择，不依赖对象引用相等。 */
export function same_model(first: ModelReference | null | undefined, second: ModelReference | null | undefined): boolean {
  if (!first || !second) return first === second;
  return first.id === second.id && ("downtown" in first
    ? "downtown" in second && first.downtown === second.downtown
    : "client" in second && first.client === second.client);
}

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

/** 公开模型信息中的模型类别。 */
export type CityModelType =
  | "language"
  | "decision"
  | "image"
  | "sound"
  | "video";

/** City 模型目录中的公开模型信息。 */
export interface CityModelDescriptor {
  /** 模型唯一 ID，用于请求 City AIService。 */
  id: string;
  /**
   * 模型类别，决定该模型可执行的能力入口。
   *
   * 由 Downtown 从模型的可执行能力推导，与 `modalities` 同源；
   * 它只用于展示与分组，判断可执行能力应读取 `modalities`。
   */
  model_type: CityModelType;
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

/**
 * 可执行 City 模型。
 *
 * 目录字段用于展示和上下文管理，执行能力使用 Downcity Model Protocol。
 */
export type CityModel = CityModelDescriptor & ModelClient & {
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
    typeof record.stream === "function"
  );
}
