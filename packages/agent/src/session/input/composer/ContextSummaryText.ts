/**
 * 摘要历史的纯文本呈现。
 * 仅保留用户/Agent 正文和工具结果，丢弃模型协议包装及工具调用参数。
 * 结构化结果使用缩进键值文本，保留字段语义，不生成 JSON 或转义正文。
 */
import type { ModelJsonValue, ModelMessage } from "@downcity/type";

/** 把统一投影后的模型消息转换为带角色标题的结果正文。 */
export function render_summary_text(messages: readonly ModelMessage[]): string {
  return messages.flatMap(message => {
    const body = message.content.flatMap(part => {
      if (part.type === "text") return part.text.trim() ? [part.text] : [];
      if (part.type !== "tool_result") return [];
      return part.content.flatMap(result => {
        if (result.type === "text") return result.text.trim() ? [result.text] : [];
        if (result.type === "json") return [render_result_text(unwrap_tool_result(result.value))];
        return [];
      });
    }).filter(text => text.trim()).join("\n\n");
    if (!body) return [];
    const role = message.role === "assistant" ? "agent" : message.role;
    return [`${role}:\n${body}`];
  }).join("\n\n");
}

/** Power 标准回执只取实际 data；失败没有 data 时保留错误正文。 */
function unwrap_tool_result(value: ModelJsonValue): ModelJsonValue {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  if (typeof value.power === "string" && typeof value.action === "string" && typeof value.success === "boolean") {
    if (value.data !== undefined && value.data !== null) return value.data;
    return value.error ?? value.message ?? null;
  }
  return value;
}

/** 递归输出可读结果；数组保留顺序，字符串原样呈现，空值不制造额外正文。 */
function render_result_text(value: ModelJsonValue, depth = 0): string {
  if (value === null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(item => render_result_text(item, depth)).filter(Boolean).join("\n\n");
  return Object.entries(value).flatMap(([key, item]) => {
    const text = render_result_text(item, depth + 1);
    if (!text) return [];
    const indent = "  ".repeat(depth);
    return [typeof item === "object" && item !== null
      ? `${indent}${key}:\n${text}` : `${indent}${key}: ${text}`];
  }).join("\n");
}
