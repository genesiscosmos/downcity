/**
 * 运行时模型元数据读取模块。
 *
 * 关键点（中文）
 * - `ModelClient.id` 是所有运行时模型都必须提供的稳定身份。
 * - `CityModel` 额外携带模型目录元数据；普通 `ModelClient` 不猜测协议外字段。
 * - 本模块只读取元数据，不参与模型选择、请求执行或失败恢复。
 */

import { isCityModel, type ModelClient } from "@downcity/type";

/** 读取模型声明的上下文窗口；普通 ModelClient 没有该目录元数据。 */
export function read_model_context_window(
  model: ModelClient | undefined,
): number | undefined {
  if (!model || !isCityModel(model)) return undefined;
  const context_window = model.context_window;
  return typeof context_window === "number"
    && Number.isSafeInteger(context_window)
    && context_window > 0
    ? context_window
    : undefined;
}

/** 读取模型展示标签；CityModel 优先展示名称，其余模型使用稳定 ID。 */
export function read_model_label(
  model: ModelClient | undefined,
): string | undefined {
  if (!model) return undefined;
  if (isCityModel(model)) return model.name.trim() || model.id;
  return model.id.trim() || undefined;
}
