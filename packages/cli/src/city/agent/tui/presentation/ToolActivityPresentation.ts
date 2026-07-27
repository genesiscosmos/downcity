/**
 * canonical Tool Part 到 Chat TUI Tool Call 视图的纯展示投影。
 *
 * 本模块只读取 Tool 名称、生命周期状态和经过筛选的基础输入字段；
 * output、error、metadata 与完整 JSON 永远不会进入展示模型。
 */

import type { SessionAssistantToolPart } from "@downcity/agent";

import type {
  ToolActivityField,
  ToolActivityPresentation,
  ToolActivityTone,
} from "@/city/agent/tui/types/ToolActivity.js";

/** 把 canonical Tool Part 转换为与终端渲染框架无关的展示信息。 */
export function present_tool_activity(
  part: SessionAssistantToolPart,
): ToolActivityPresentation {
  return {
    tool_name: String(part.tool_name || "unknown_tool"),
    state_label: resolve_state_label(part.state),
    tone: resolve_state_tone(part.state),
    fields: resolve_tool_fields(part),
  };
}

/** 根据 canonical 六态提供稳定的用户可读状态。 */
function resolve_state_label(state: SessionAssistantToolPart["state"]): string {
  switch (state) {
    case "input-streaming":
      return "Preparing input";
    case "ready":
      return "Ready";
    case "waiting-user":
      return "Waiting for approval";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

/** 根据 canonical 状态选择终端语义颜色。 */
function resolve_state_tone(
  state: SessionAssistantToolPart["state"],
): ToolActivityTone {
  switch (state) {
    case "waiting-user":
      return "waiting";
    case "completed":
      return "success";
    case "failed":
      return "error";
    default:
      return "active";
  }
}

/** 按 Tool 语义提取少量、有字段名的基础调用输入。 */
function resolve_tool_fields(part: SessionAssistantToolPart): ToolActivityField[] {
  const input = as_record(part.input);
  const tool_name = part.tool_name.toLowerCase();

  if (tool_name === "read" || tool_name === "write" || tool_name === "edit") {
    return compact_fields([
      field("path", read_string(input, "file_path") || read_string(input, "path")),
    ]);
  }
  if (tool_name === "grep" || tool_name === "find" || tool_name === "glob") {
    return compact_fields([
      field("pattern", read_string(input, "pattern") || read_string(input, "query")),
      field("path", read_string(input, "path") || read_string(input, "cwd")),
    ]);
  }
  if (tool_name.startsWith("shell_")) {
    return compact_fields([
      field(
        "command",
        read_string(input, "cmd") ||
          read_string(input, "command") ||
          read_string(input, "code"),
      ),
      field(
        "cwd",
        read_string(input, "cwd") || read_string(input, "workdir"),
      ),
      field("action", read_string(input, "action")),
    ]);
  }
  if (tool_name === "plugin_read" || tool_name === "plugin_call") {
    return compact_fields([
      field("plugin", read_string(input, "plugin")),
      field("action", read_string(input, "action")),
    ]);
  }

  return summarize_generic_input(input);
}

/** Generic Tool 最多展示三个简单字段，避免把完整 JSON 泄漏到 Transcript。 */
function summarize_generic_input(
  input: Record<string, unknown> | null,
): ToolActivityField[] {
  if (!input) return [];
  return Object.entries(input)
    .filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    })
    .slice(0, 3)
    .map(([label, value]) => ({
      label,
      value: first_line(String(value)),
    }))
    .filter((item) => item.value.length > 0);
}

/** 构造一个可能为空的展示字段。 */
function field(label: string, value: string): ToolActivityField | null {
  const normalized_value = first_line(value);
  return normalized_value ? { label, value: normalized_value } : null;
}

/** 移除空字段并保持调用者定义的展示顺序。 */
function compact_fields(
  fields: Array<ToolActivityField | null>,
): ToolActivityField[] {
  return fields.filter((item): item is ToolActivityField => item !== null);
}

/** 安全读取 JSON Object。 */
function as_record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 安全读取字符串字段。 */
function read_string(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/** 把多行输入压缩为一行，避免破坏 Tool Call 的视觉层级。 */
function first_line(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() || "";
}
