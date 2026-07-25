/**
 * Canonical Session Message 时间线投影。
 *
 * 关键点（中文）
 * - 只接收公开的 SessionMessage，不暴露 JSONL 或内部 Executor Record。
 * - 为 CLI、控制台与其他宿主提供同一套用户可见时间线语义。
 * - 纯数据转换，不读取文件，也不持有 Session 运行态。
 */

import type {
  AgentSessionTimelineEvent,
} from "@/types/agent/SessionTypes.js";
import type {
  SessionAssistantToolPart,
  SessionMessage,
} from "@/types/session/SessionMessage.js";

/** 将未知数据转换为有界展示文本。 */
function stringify_for_display(input: unknown, max_chars = 2400): string {
  if (input === undefined) return "";
  if (input === null) return "null";
  const value = typeof input === "string"
    ? input.trim()
    : JSON.stringify(input, null, 2);
  if (!value) return "";
  return value.length <= max_chars
    ? value
    : `${value.slice(0, Math.max(0, max_chars - 1)).trimEnd()}…`;
}

/** 创建一个带稳定 Message 内序号的时间线事件。 */
function create_timeline_event(input: {
  /** 来源 Message。 */
  message: SessionMessage;
  /** 事件角色。 */
  role: AgentSessionTimelineEvent["role"];
  /** 展示文本。 */
  text: string;
  /** Message 内事件序号。 */
  index: number;
  /** 可选工具名称。 */
  tool_name?: string;
}): AgentSessionTimelineEvent {
  return {
    id: `${input.message.message_id}:${input.index}`,
    role: input.role,
    ts: input.message.updated_at,
    text: input.text,
    ...(input.tool_name ? { tool_name: input.tool_name } : {}),
  };
}

/** 将单个 Tool Part 展开为调用与可选结果事件。 */
function project_tool_part(
  message: SessionMessage,
  part: SessionAssistantToolPart,
  start_index: number,
): AgentSessionTimelineEvent[] {
  const events = [create_timeline_event({
    message,
    role: "tool-call",
    text: stringify_for_display(part.input ?? part.input_text) || "(empty)",
    index: start_index,
    tool_name: part.tool_name,
  })];
  const output = part.state === "completed"
    ? part.output
    : part.state === "failed"
      ? { error: part.error || "tool_error" }
      : undefined;
  if (output !== undefined) {
    events.push(create_timeline_event({
      message,
      role: "tool-result",
      text: stringify_for_display(output) || "(empty)",
      index: start_index + 1,
      tool_name: part.tool_name,
    }));
  }
  return events;
}

/** 把一条 canonical Session Message 投影为 UI 时间线事件。 */
export function to_session_message_timeline_events(
  message: SessionMessage,
): AgentSessionTimelineEvent[] {
  if (message.type === "action") {
    return [{
      id: `${message.message_id}:0`,
      role: "action",
      ts: message.updated_at,
      text: message.description
        ? `${message.title}\n${message.description}`
        : message.title,
      action_title: message.title,
      ...(message.description ? { action_description: message.description } : {}),
      action_state: message.status,
    }];
  }
  if (message.type === "error") {
    return [create_timeline_event({
      message,
      role: "assistant",
      text: message.message,
      index: 0,
    })];
  }
  if (message.type === "user") {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n");
    return [create_timeline_event({ message, role: "user", text, index: 0 })];
  }

  const events: AgentSessionTimelineEvent[] = [];
  for (const part of [...message.parts].sort((left, right) => left.sequence - right.sequence)) {
    if (part.type === "text") {
      const text = part.text.trim();
      if (text) {
        events.push(create_timeline_event({
          message,
          role: "assistant",
          text,
          index: events.length,
        }));
      }
      continue;
    }
    if (part.type !== "tool") continue;
    events.push(...project_tool_part(message, part, events.length));
  }
  return events;
}
