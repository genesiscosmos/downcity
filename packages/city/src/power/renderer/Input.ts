/** Input 确切生产信封的窄读取器；不解析任意 text，不暴露来源或原始结构。 */
import type { SessionAgentInputPart } from "@downcity/type";
import { record_value, text_value } from "./Activity.js";

/** 仅在 kind 与 context tag 一致时解析，限制大小并隔离损坏历史。 */
export function input_envelope(input: Readonly<SessionAgentInputPart>, kind: string): Record<string, unknown> {
  if (input.kind !== kind) return {};
  const item = input.content.find(item => item.type === "context" && item.tag === kind);
  if (!item || item.type !== "context" || item.context.length > 1_048_576) return {};
  try { return record_value(JSON.parse(item.context)); } catch { return {}; }
}

/** power_result 的归属只取确切信封中的 power_id；其他事件由已知生产方解释。 */
export function input_power_id(input: Readonly<SessionAgentInputPart>): string {
  if (input.kind === "tool_media" && input.content.some(item => item.type === "context" && item.tag === "skill")) return "skill";
  if (input.kind === "shell_result") return "shell";
  if (input.kind === "delegation_result") return "session";
  if (input.kind === "power_result") return text_value(input_envelope(input, "power_result").power_id);
  return "session";
}
