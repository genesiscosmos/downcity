/** 将 Federation 自定义价格文案转换为价格对比图数据。 */

import type { DesktopModelSummary } from "@common/types/DesktopApi";
import type { ModelPricingPoint } from "@/types/ModelPricing";

const price_pattern = /(?:\$|usd|美元|credits?|credit|积分)?\s*(\d+(?:\.\d+)?)\s*(?:\$|usd|美元|credits?|credit|积分)?\s*\/\s*(\d+(?:\.\d+)?)\s*(k|千|m|百万)?\s*(?:tokens?|token|令牌)/iu;

/** 解析模型价格文案，统一换算为每 1M tokens 的美元价格。 */
function parse_price_entry(entry: string): { kind: "input" | "output"; usd_per_1m: number } | null {
  const normalized_entry = entry.trim();
  const kind = /输出|output|completion/iu.test(normalized_entry) ? "output" : /输入|input|prompt/iu.test(normalized_entry) ? "input" : null;
  if (!kind) return null;
  const price_match = normalized_entry.match(price_pattern);
  if (!price_match) return null;
  const amount = Number(price_match[1]);
  const token_count = Number(price_match[2]) * (price_match[3]?.toLowerCase() === "m" || price_match[3] === "百万" ? 1_000 : price_match[3] ? 1 : 0.001);
  if (!Number.isFinite(amount) || !Number.isFinite(token_count) || token_count <= 0) return null;
  return { kind, usd_per_1m: amount * 1_000 / token_count };
}

/** 只返回同时具备输入与输出价格的文本模型，并按最高单价降序排列。 */
export function build_model_pricing(models: DesktopModelSummary[]): ModelPricingPoint[] {
  return models.flatMap((model) => {
    const parsed = (model.price ?? []).map(parse_price_entry).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const input = parsed.filter((entry) => entry.kind === "input").sort((left, right) => right.usd_per_1m - left.usd_per_1m)[0];
    const output = parsed.filter((entry) => entry.kind === "output").sort((left, right) => right.usd_per_1m - left.usd_per_1m)[0];
    return input && output ? [{ model_id: model.model_id, model_name: model.name, input_usd_per_1m: input.usd_per_1m, output_usd_per_1m: output.usd_per_1m }] : [];
  }).sort((left, right) => Math.max(right.input_usd_per_1m, right.output_usd_per_1m) - Math.max(left.input_usd_per_1m, left.output_usd_per_1m));
}
