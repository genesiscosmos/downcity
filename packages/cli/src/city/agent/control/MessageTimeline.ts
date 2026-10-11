/**
 * Control canonical SessionMessage 时间线投影。
 *
 * CLI 只在展示边界把 canonical Message 展开为时间线事件；读取和执行链路不创建
 * UI Message 中间协议。
 */

import fs from "fs-extra";
import type { SessionMessage } from "@downcity/agent";
import {
  extract_session_message_text,
  resolve_session_assistant_visible_text,
} from "@downcity/agent";
import type {
  ControlTimelineEvent,
  ControlTimelineRole,
} from "@/city/agent/control/types/ControlViewData.js";
import { truncateText } from "@/city/agent/control/CommonHelpers.js";

/** 把结构化值格式化为时间线文本。 */
function stringify_for_display(input: unknown, max_chars = 2400): string {
  if (input === undefined) return "";
  if (input === null) return "null";
  if (typeof input === "string") return truncateText(input.trim(), max_chars);
  try {
    return truncateText(JSON.stringify(input, null, 2), max_chars);
  } catch {
    return truncateText(String(input), max_chars);
  }
}

/** 构造一条普通 canonical Message 时间线事件。 */
function to_message_event(input: {
  /** 来源 canonical Message。 */
  message: SessionMessage;
  /** 展示角色。 */
  role: ControlTimelineRole;
  /** 展示文本。 */
  text: string;
  /** Message 内事件序号。 */
  sequence: number;
  /** 可选工具名称。 */
  tool_name?: string;
}): ControlTimelineEvent {
  return {
    id: `${input.message.message_id}:${String(input.sequence)}`,
    role: input.role,
    ts: input.message.updated_at,
    text: input.text,
    ...(input.tool_name ? { tool_name: input.tool_name } : {}),
  };
}

/** 读取一条 canonical Message 的用户可见预览。 */
export function resolve_message_preview(message: SessionMessage): string {
  if (message.role === "agent") {
    const visible_text = resolve_session_assistant_visible_text(message);
    if (visible_text) return visible_text;
    for (const part of message.parts) {
      if (part.type === "action") {
        return part.description ? `${part.title}\n${part.description}` : part.title;
      }
      if (part.type === "error") return part.message;
    }
    const tool_names = [...new Set(
      message.parts.flatMap((part) => part.type === "tool" ? [part.tool_name] : []),
    )];
    return tool_names.length > 0 ? `[tool] ${tool_names.join(", ")}` : "";
  }
  return extract_session_message_text(message);
}

/** 把一条 canonical Message 展开为 Control 时间线。 */
export function to_message_timeline(message: SessionMessage): ControlTimelineEvent[] {
  if (message.role === "user") {
    return [to_message_event({
      message,
      role: "user",
      text: resolve_message_preview(message),
      sequence: 0,
    })];
  }

  const events: ControlTimelineEvent[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) {
      events.push(to_message_event({
        message,
        role: "assistant",
        text: part.text.trim(),
        sequence: events.length,
      }));
    } else if (part.type === "tool") {
      events.push(to_message_event({
        message,
        role: "tool-call",
        text: stringify_for_display(part.input) || "(empty)",
        sequence: events.length,
        tool_name: part.tool_name,
      }));
      if (part.state === "completed" || part.state === "failed") {
        events.push(to_message_event({
          message,
          role: "tool-result",
          text: stringify_for_display(
            part.state === "failed"
              ? { error: part.error || "tool_error" }
              : part.output,
          ) || "(empty)",
          sequence: events.length,
          tool_name: part.tool_name,
        }));
      }
    } else if (part.type === "action") {
      events.push({
        id: `${message.message_id}:${String(events.length)}`,
        role: "action",
        ts: message.updated_at,
        text: part.description ? `${part.title}\n${part.description}` : part.title,
        action_title: part.title,
        ...(part.description ? { action_description: part.description } : {}),
        action_state: part.state,
      });
    } else if (part.type === "error") {
      events.push(to_message_event({
        message,
        role: "assistant",
        text: part.message,
        sequence: events.length,
      }));
    }
  }
  if (events.length === 0) {
    events.push(to_message_event({
      message,
      role: "assistant",
      text: resolve_message_preview(message),
      sequence: 0,
    }));
  }
  return events;
}

/** 从 JSONL 文件读取并折叠 canonical Message revision。 */
export async function load_session_messages_from_file(
  file_path: string,
): Promise<SessionMessage[]> {
  if (!(await fs.pathExists(file_path))) return [];
  const raw = await fs.readFile(file_path, "utf-8");
  const messages_by_id = new Map<string, SessionMessage>();
  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      const message = JSON.parse(line) as SessionMessage;
      if (!is_session_message(message)) continue;
      const previous = messages_by_id.get(message.message_id);
      if (!previous || message.revision > previous.revision) {
        messages_by_id.set(message.message_id, message);
      }
    } catch {
      // 单行损坏不应影响其他 canonical Message。
    }
  }
  return [...messages_by_id.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

/** 判断未知值是否为 canonical SessionMessage。 */
function is_session_message(input: unknown): input is SessionMessage {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const candidate = input as Partial<SessionMessage>;
  return typeof candidate.message_id === "string" &&
    typeof candidate.sequence === "number" &&
    typeof candidate.revision === "number" &&
    (candidate.role === "user" || candidate.role === "agent");
}
