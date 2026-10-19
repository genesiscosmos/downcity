/** Power 输出的模型历史投影：保留 canonical 原始参数，模型只读取已发布内容摘要。 */
import type { JsonValue, SessionMessage } from "@downcity/type";

/** 读取当前消息中由可信执行来源关联的展示摘要。 */
export function published_power_summaries(message: SessionMessage): ReadonlyMap<string, string> {
  const summaries = new Map<string, string>();
  if (message.role !== "agent") return summaries;
  for (const part of message.parts) {
    if (part.type !== "power" || !part.source_tool_call_id) continue;
    const previous = summaries.get(part.source_tool_call_id);
    summaries.set(part.source_tool_call_id, previous ? `${previous}\n${part.fallback_text}` : part.fallback_text);
  }
  return summaries;
}

/**
 * 已发布内容只压缩描述字段，保留 Power 调用 envelope 与其余参数。
 *
 * 不能把整个 input 替换为摘要：模型需要知道 action 已经执行过。
 * 未识别的业务形状原样返回；原始参数始终保存在 canonical Tool Part。
 */
export function project_published_tool_input(input: JsonValue | undefined, summary: string | undefined): JsonValue {
  if (summary === undefined || !is_object(input) || !is_object(input.args)) return input ?? null;
  const args = input.args;
  const omitted = `[Published UI description omitted from model history. Summary: ${summary}]`;
  if (typeof args.content === "string") {
    return { ...input, args: { ...args, content: omitted } };
  }
  if (is_object(args.spec)) {
    return { ...input, args: { ...args, spec: { _downcity_projection: "published_power_content", summary } } };
  }
  return input;
}

/** JSON 对象判断，不改变调用方拥有的数据。 */
function is_object(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
