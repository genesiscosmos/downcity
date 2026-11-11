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
  to_session_message_timeline_events,
} from "@downcity/agent";
import type {
  ControlTimelineEvent,
} from "@/city/agent/control/types/ControlViewData.js";

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
  return to_session_message_timeline_events(message).map((event) => ({
    ...event,
    role: event.role === "agent" ? "assistant" : event.role,
  }));
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
