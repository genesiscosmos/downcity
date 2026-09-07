/**
 * 模型客户端元数据读取模块。
 *
 * ModelClient 直接声明运行时可选元数据，调用方无需识别具体 Provider 或 CityModel。
 */

import type { ModelClient } from "./ModelClient.js";

/** 读取模型声明的合法上下文窗口。 */
export function read_model_context_window(
  model: ModelClient | undefined,
): number | undefined {
  const context_window = model?.context_window;
  return typeof context_window === "number"
    && Number.isSafeInteger(context_window)
    && context_window > 0
    ? context_window
    : undefined;
}

/** 读取模型可读标签，名称为空时回退到稳定 ID。 */
export function read_model_label(
  model: ModelClient | undefined,
): string | undefined {
  if (!model) return undefined;
  return model.name?.trim() || model.id.trim() || undefined;
}
