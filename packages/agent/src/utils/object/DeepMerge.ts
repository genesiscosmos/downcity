/**
 * 通用深合并工具模块。
 *
 * 职责说明（中文）
 * - 提供对象递归合并能力，供配置装配等“层层覆盖”场景复用。
 * - 统一约束数组与标量的覆盖语义，避免不同模块出现不一致行为。
 * - 这里只负责结构合并，不负责字段合法性校验。
 */

import { is_plain_object } from "@/utils/object/ObjectGuards.js";

/**
 * 深合并两个未知值。
 *
 * 关键点（中文）
 * - 只有“对象 + 对象”会递归合并。
 * - 数组始终以 `override` 为准，不做拼接。
 * - 当 `override === undefined` 时保留 `base`，便于做配置层覆盖。
 */
export function deep_merge(base: unknown, override: unknown): unknown {
  if (!is_plain_object(base) || !is_plain_object(override)) {
    return override === undefined ? base : override;
  }

  const out: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = base[key];
    if (Array.isArray(overrideValue)) {
      out[key] = overrideValue;
      continue;
    }
    if (is_plain_object(overrideValue) && is_plain_object(baseValue)) {
      out[key] = deep_merge(baseValue, overrideValue);
      continue;
    }
    out[key] = overrideValue === undefined ? baseValue : overrideValue;
  }

  return out;
}
