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
  SessionAgentToolPart,
  SessionMessage,
} from "@downcity/type";

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
  part: SessionAgentToolPart,
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
  if (message.role === "user") {
    const text_parts: string[] = [];
    for (const part of message.parts) {
      switch (part.type) {
        case "text":
          if (part.text.trim()) text_parts.push(part.text.trim());
          break;
        case "context":
        case "file":
        case "data":
          break;
        default:
          assert_never(part);
      }
    }
    const text = text_parts.join("\n");
    return [create_timeline_event({ message, role: "user", text, index: 0 })];
  }

  const events: AgentSessionTimelineEvent[] = [];
  for (const part of [...message.parts].sort((left, right) => left.sequence - right.sequence)) {
    switch (part.type) {
      case "text": {
        const text = part.text.trim();
        if (text) {
          events.push(create_timeline_event({
            message,
            role: "agent",
            text,
            index: events.length,
          }));
        }
        break;
      }
      case "action":
        events.push({
          id: `${message.message_id}:${events.length}`,
          role: "action",
          ts: message.updated_at,
          text: part.description
            ? `${part.title}\n${part.description}`
            : part.title,
          action_title: part.title,
          ...(part.description ? { action_description: part.description } : {}),
          action_state: part.state,
        });
        break;
      case "error":
        events.push(create_timeline_event({
          message,
          role: "agent",
          text: part.message,
          index: events.length,
        }));
        break;
      case "tool":
        events.push(...project_tool_part(message, part, events.length));
        break;
      case "reasoning":
      case "file":
      case "data":
        break;
      default:
        assert_never(part);
    }
  }
  return events;
}

/** canonical Part 联合类型新增成员时强制时间线显式处理。 */
function assert_never(value: never): never {
  throw new Error(`Unsupported timeline Session Part: ${String((value as { type?: unknown }).type)}`);
}
