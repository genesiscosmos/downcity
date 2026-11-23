/**
 * AI 模型结构化价格计算模块。
 *
 * 只负责解释公开 pricing 数据，不包含 Credits、markup 或账单持久化策略。
 */

import type { ModelPricing } from "@downcity/type";

/** 从多个方案中选择完全匹配条件的价格方案。 */
export function select_model_pricing(
  pricing: ModelPricing | ModelPricing[],
  dimensions: Record<string, string> = {},
): ModelPricing | undefined {
  const values = Array.isArray(pricing) ? pricing : [pricing];
  return values.find((item) => Object.entries(item.dimensions ?? {}).every(([key, value]) => dimensions[key] === value));
}

/** 根据计量组件计算原始货币金额。 */
export function calculate_model_price(
  pricing: ModelPricing,
  usage: Record<string, number>,
): number {
  const scale = pricing.scale ?? 1;
  return Object.entries(usage).reduce((total, [key, amount]) => {
    const rate = pricing.rates[key];
    if (rate === undefined) return total;
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid usage amount: ${key}`);
    return total + amount / scale * rate;
  }, 0);
}
