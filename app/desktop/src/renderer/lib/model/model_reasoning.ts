/** Desktop 模型推理强度展示文案。 */

import type { DesktopModelReasoning, DesktopModelSummary } from "@common/types/DesktopApi";

function read_reasoning(model: Pick<DesktopModelSummary, "reasoning">): DesktopModelReasoning | undefined {
  const reasoning = model.reasoning;
  if (!reasoning || !Array.isArray(reasoning.efforts)) return undefined;
  const efforts = reasoning.efforts.filter((effort) => effort.id.trim() && effort.name.trim());
  return efforts.length ? { ...reasoning, efforts } : undefined;
}

/** 返回模型默认推理档位；默认值缺失或不在目录中时返回空值。 */
export function get_default_model_reasoning(model: Pick<DesktopModelSummary, "reasoning">) {
  const reasoning = read_reasoning(model);
  if (!reasoning?.default_effort) return undefined;
  return reasoning.efforts.find((effort) => effort.id === reasoning.default_effort);
}

/** 返回模型支持的推理强度摘要；没有推理配置时返回空值。 */
export function format_model_reasoning(model: Pick<DesktopModelSummary, "reasoning">): string {
  const reasoning = read_reasoning(model);
  if (!reasoning) return "";
  const labels = reasoning.efforts.map((effort) => effort.name).filter(Boolean);
  if (!labels.length) return "";
  return `推理：${labels.join(" / ")}`;
}

/** 返回模型默认推理档位的展示名称；没有默认档位时返回空值。 */
export function format_default_model_reasoning(model: Pick<DesktopModelSummary, "reasoning">): string {
  const effort = get_default_model_reasoning(model);
  return effort?.name ? `默认：${effort.name}` : "";
}
