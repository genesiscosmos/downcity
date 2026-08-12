/**
 * AI 模型类型（公开目录统一使用 CityModelDescriptor）。
 *
 * 关键点（中文）
 * - CityModel 是 @downcity/city 提供的原生 LanguageModelV3 class。
 * - UserModelRef 保留为 Federation 内部语义别名，避免一次性扩大改名范围。
 */

import type { CityModelEnvRequirement } from "@downcity/type";
import type { CityModel } from "./CityModel.js";

export type UserModelEnvRequirement = CityModelEnvRequirement;

/** 客户端可见的 Model 引用。 */
export type UserModelRef = CityModel;

/** 模型标识（Ref 或 ID 字符串）。 */
export type UserModelInput = UserModelRef | string;
