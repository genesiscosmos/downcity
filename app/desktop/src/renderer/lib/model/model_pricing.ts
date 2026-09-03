/** 将 Federation 结构化价格转换为价格对比图数据。 */

import type { DesktopModelSummary } from "@common/types/DesktopApi";
import type { ModelPricingPoint } from "@/types/ModelPricing";

/** 只返回同时具备输入与输出价格的文本模型，并按最高单价降序排列。 */
export function build_model_pricing(models: DesktopModelSummary[]): ModelPricingPoint[] {
  return models.flatMap((model) => {
    const pricing = (model.pricing ?? []).filter((item) =>
      item.currency.toUpperCase() === "USD"
      && item.unit.toLowerCase() === "token"
      && Number.isFinite(item.scale ?? 1)
      && (item.scale ?? 1) > 0
    );
    const input = pricing
      .map((item) => item.rates.input * 1_000_000 / (item.scale ?? 1))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0];
    const output = pricing
      .map((item) => item.rates.output * 1_000_000 / (item.scale ?? 1))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0];
    return input !== undefined && output !== undefined
      ? [{ model_id: model.model_id, model_name: model.name, input_usd_per_1m: input, output_usd_per_1m: output }]
      : [];
  }).sort((left, right) => Math.max(right.input_usd_per_1m, right.output_usd_per_1m) - Math.max(left.input_usd_per_1m, left.output_usd_per_1m));
}
