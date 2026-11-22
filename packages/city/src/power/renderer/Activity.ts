/**
 * City 自有活动的浏览器安全投影工具。只读取 canonical 输入和结果信封，
 * 不依赖后端 Power、宿主 UI 或网络；describe 只选择少量明确业务字段。
 */
import type { PowerActivityDescription, PowerActivityProps } from "../types/PowerActivityRenderer.js";

/** 仅接受普通记录；不将未知数据强制转换为文本。 */
export function record_value(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 文本字段读取。 */
export function text_value(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 只读取前十二项并保留有效记录，避免详情遍历整个大型结果。 */
export function record_items(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.slice(0, 12).filter(item => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
}

/** 当前 locale 的中文判断，包含 zh-CN、zh-TW。 */
export function is_chinese(locale: string): boolean {
  return /^zh(?:-|$)/i.test(locale);
}

/** Power action 标识来自输入；省略 action 表示浏览动作索引。 */
export function action_id(props: PowerActivityProps): string {
  return text_value(record_value(props.tool.input).action);
}

/** Power 参数唯一来源，不读取流式 input_text 或 model_output。 */
export function input_args(props: PowerActivityProps): Record<string, unknown> {
  return record_value(record_value(props.tool.input).args);
}

/** Power 完整业务结果位于 canonical output.data。 */
export function output_data(props: PowerActivityProps): Record<string, unknown> {
  return record_value(record_value(props.tool.output).data);
}

/** 摘要先截取再归一空白，避免折叠阶段遍历大文本。 */
export function short_text(value: unknown): string | undefined {
  return text_value(value).slice(0, 240).replace(/\s+/g, " ").trim() || undefined;
}

/** 只处理 canonical 调用失败和等待；各 Power 自己判断业务信封，目标状态不参与公共推断。 */
export function activity_tone(props: PowerActivityProps): PowerActivityDescription["tone"] {
  const { tool } = props;
  if (tool.state === "failed") return "failed";
  if (tool.state === "waiting-user") return "waiting";
  const output = record_value(tool.output);
  if (tool.state === "completed" && output.success === false) return "failed";
  return tool.state === "completed" ? "complete" : "running";
}

/** 本次调用失败的明确说明，不扫描完整输出或目标会话的 failure 快照。 */
export function failure_text(props: PowerActivityProps): string {
  const output = record_value(props.tool.output);
  const data = output_data(props);
  return text_value(props.tool.error) || text_value(output.error) || text_value(data.error);
}
