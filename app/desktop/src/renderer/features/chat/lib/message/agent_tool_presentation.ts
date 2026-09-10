/** Agent Tool canonical 状态到稳定展示语义的纯映射。 */

import type { SessionAgentToolPart } from "@downcity/agent";
import type { AgentActivityPart, AgentToolPresentation, AgentToolVisualKind } from "@/features/chat/types/AgentMessage";

/** 将 canonical Tool 映射为图标、状态与单行摘要。 */
export function resolve_agent_tool_presentation(part: SessionAgentToolPart): AgentToolPresentation {
  const visual_kind = resolve_tool_visual_kind(part.tool_name);
  const running = part.state === "input-streaming" || part.state === "ready" || part.state === "running";
  const failed = part.state === "failed";
  return {
    visual_kind,
    state_key: resolve_tool_state_key(visual_kind, part.state),
    detail: resolve_tool_detail(part, visual_kind),
    running,
    failed,
  };
}

/** Write 与 Edit 开始接收输入时自动展开一次；之后仍允许用户手动折叠。 */
export function should_auto_open_agent_tool(part: SessionAgentToolPart): boolean {
  if (part.state !== "input-streaming") return false;
  const visual_kind = resolve_tool_visual_kind(part.tool_name);
  return visual_kind === "write" || visual_kind === "edit";
}

/** 待响应 Interaction 或流式文件内容出现时，活动组自动展开一次但不锁定。 */
export function should_auto_open_agent_activity(parts: readonly AgentActivityPart[]): boolean {
  return parts.some((part) => part.type === "interaction"
    ? part.status === "pending"
    : part.type === "tool" && should_auto_open_agent_tool(part));
}

/** 从常见结构化输入中读取第一个非空字符串。 */
export function read_agent_tool_input_text(input: unknown, keys: readonly string[]): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** 根据注册名称识别 Tool 的稳定视觉种类。 */
function resolve_tool_visual_kind(tool_name: string): AgentToolVisualKind {
  const normalized = tool_name.toLowerCase();
  if (normalized === "read" || normalized.endsWith("_read")) return "read";
  if (normalized === "write" || normalized.endsWith("_write")) return "write";
  if (normalized === "edit" || normalized.endsWith("_edit")) return "edit";
  if (normalized === "grep" || normalized.includes("search")) return "grep";
  if (normalized === "find" || normalized.includes("glob")) return "find";
  if (normalized === "shell_exec" || normalized === "shell_session" || normalized.includes("terminal")) return "shell";
  if (normalized === "ask_question" || normalized.includes("question")) return "ask";
  if (normalized === "plugin_call" || normalized.startsWith("plugin_")) return "plugin";
  return "generic";
}

/** 将 Tool 生命周期收敛为对应视觉种类的翻译 key。 */
function resolve_tool_state_key(visual_kind: AgentToolVisualKind, state: SessionAgentToolPart["state"]): string {
  if (state === "waiting-user") return "activity.waiting_confirmation";
  const lifecycle = state === "failed" ? "failed" : state === "completed" ? "completed" : "running";
  return `activity.${visual_kind}.${lifecycle}`;
}

/** 从 Tool 输入提取最有辨识度的摘要。 */
function resolve_tool_detail(part: SessionAgentToolPart, visual_kind: AgentToolVisualKind): string {
  const input = part.input;
  if (visual_kind === "read" || visual_kind === "write" || visual_kind === "edit") {
    return read_agent_tool_input_text(input, ["file_path", "path", "filename"]) || part.title || part.tool_name;
  }
  if (visual_kind === "grep") return read_agent_tool_input_text(input, ["pattern", "query", "text"]) || part.title || part.tool_name;
  if (visual_kind === "find") return read_agent_tool_input_text(input, ["pattern", "glob", "path"]) || part.title || part.tool_name;
  if (visual_kind === "shell") {
    const action = read_agent_tool_input_text(input, ["action"]);
    const command = read_agent_tool_input_text(input, ["cmd", "command", "input"]);
    return [action, command].filter(Boolean).join(" · ") || part.title || part.tool_name;
  }
  if (visual_kind === "plugin") {
    const plugin = read_agent_tool_input_text(input, ["plugin", "plugin_id"]);
    const action = read_agent_tool_input_text(input, ["action", "action_name"]);
    return [plugin, action].filter(Boolean).join(" · ") || part.title || part.tool_name;
  }
  return part.title || part.tool_name;
}
