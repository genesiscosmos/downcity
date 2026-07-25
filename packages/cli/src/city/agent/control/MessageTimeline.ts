/**
 * Control 消息时间线 helper。
 *
 * 关键点（中文）
 * - 负责把上下文消息映射成 control UI 可视时间线。
 * - 同时提供消息文件读取能力。
 */

import fs from "fs-extra";
import {
  getToolName,
  isTextUIPart,
  isToolUIPart,
  type UIMessagePart,
} from "ai";
import type {
  SessionActionRecordV1,
  SessionRecordV1,
  SessionMessageRecordV1,
  SessionMetadataV1,
} from "@downcity/agent";
import {
  is_session_action_record,
  is_session_message_record,
} from "@downcity/agent";
import { pick_last_successful_chat_send_text } from "@downcity/agent";
import { extract_tool_calls_from_ui_message } from "@downcity/agent";
import type { ControlTimelineEvent, ControlTimelineRole } from "@/city/agent/control/types/ControlViewData.js";
import { truncateText } from "@/city/agent/control/CommonHelpers.js";

type AnyUiPart = UIMessagePart<Record<string, never>, Record<string, never>>;

type ToolPartCompatShape = {
  type?: unknown;
  state?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
  error?: unknown;
  approval?: { reason?: unknown } | null;
};

function stringifyForDisplay(input: unknown, maxChars = 2400): string {
  if (input === undefined) return "";
  if (input === null) return "null";
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) return "";
    try {
      const parsed = JSON.parse(value);
      return truncateText(JSON.stringify(parsed, null, 2), maxChars);
    } catch {
      return truncateText(value, maxChars);
    }
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return truncateText(String(input), maxChars);
  }
  try {
    return truncateText(JSON.stringify(input, null, 2), maxChars);
  } catch {
    return truncateText(String(input), maxChars);
  }
}

function extractMessageText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const texts: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type !== "text") continue;
    if (typeof p.text !== "string") continue;
    const value = p.text.trim();
    if (!value) continue;
    texts.push(value);
  }
  return texts.join("\n").trim();
}

function extractAssistantToolSummary(message: SessionMessageRecordV1): string {
  const toolCalls = extract_tool_calls_from_ui_message(message);
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return "";
  const toolNames = Array.from(
    new Set(toolCalls.map((item) => String(item.tool || "").trim()).filter(Boolean)),
  );
  if (toolNames.length === 0) return "";
  return `[tool] ${toolNames.join(", ")}`;
}

function resolveToolName(part: ToolPartCompatShape, aiToolName?: string): string {
  const fromAi = String(aiToolName || "").trim();
  if (fromAi) return fromAi;

  const rawType = typeof part.type === "string" ? part.type.trim() : "";
  if (rawType.startsWith("tool-")) return rawType.slice("tool-".length);
  return "unknown_tool";
}

function extractToolCallInput(part: ToolPartCompatShape): unknown {
  return part.input ?? undefined;
}

function extractToolResultOutput(part: ToolPartCompatShape): unknown {
  const state = typeof part.state === "string" ? part.state.trim() : "";
  if (state === "output-available") return part.output;
  if (state === "output-error") {
    return { error: part.errorText ?? part.error ?? "tool_error" };
  }
  if (state === "output-denied") {
    return {
      error: "tool_denied",
      reason: part.approval?.reason ?? "",
    };
  }
  if (
    state === "input-available" ||
    state === "input-streaming" ||
    state === "output-streaming"
  ) {
    return undefined;
  }
  return undefined;
}

function toUiMessageEvent(params: {
  message: SessionMessageRecordV1;
  role: ControlTimelineRole;
  text: string;
  sequence: number;
  tool_name?: string;
}): ControlTimelineEvent {
  const { message, role, text, sequence, tool_name } = params;
  const metadata = (message.metadata || null) as SessionMetadataV1 | null;

  return {
    id: `${String(message.id || "")}:${sequence}`,
    role,
    ...(typeof metadata?.ts === "number" ? { ts: metadata.ts } : {}),
    ...(typeof metadata?.kind === "string" ? { kind: metadata.kind } : {}),
    ...(typeof metadata?.source === "string" ? { source: metadata.source } : {}),
    text,
    ...(tool_name ? { tool_name } : {}),
  };
}

function toActionEvent(message: SessionActionRecordV1): ControlTimelineEvent {
  const metadata = message.metadata || null;
  return {
    id: `${String(message.id || "")}:0`,
    role: "action",
    ...(typeof metadata?.ts === "number" ? { ts: metadata.ts } : {}),
    text: resolveUiMessageText(message),
    action_title: message.title,
    ...(message.description ? { action_description: message.description } : {}),
    action_state: message.state,
  };
}

function resolveUiMessageText(message: SessionRecordV1): string {
  if (is_session_action_record(message)) {
    return message.description
      ? `${message.title}\n${message.description}`
      : message.title;
  }
  if (!is_session_message_record(message)) return "";

  const plainText = extractMessageText(message.parts);
  if (plainText) return plainText;

  if (message.role !== "assistant") return "";

  const userVisible = pick_last_successful_chat_send_text(message).trim();
  if (userVisible) return userVisible;

  return extractAssistantToolSummary(message);
}

/**
 * 转成 control 时间线。
 */
export function toUiMessageTimeline(
  message: SessionRecordV1,
): ControlTimelineEvent[] {
  if (is_session_action_record(message)) {
    return [toActionEvent(message)];
  }

  if (!is_session_message_record(message)) return [];
  if (message.role !== "assistant") {
    return [
      toUiMessageEvent({
        message,
        role: message.role,
        text: resolveUiMessageText(message),
        sequence: 0,
      }),
    ];
  }

  const parts = Array.isArray(message.parts)
    ? (message.parts as AnyUiPart[])
    : [];
  const events: ControlTimelineEvent[] = [];
  let sequence = 0;

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const partObject = part as ToolPartCompatShape;

    if (isTextUIPart(part)) {
      const text = String(part.text || "").trim();
      if (!text) continue;
      events.push(
        toUiMessageEvent({
          message,
          role: "assistant",
          text,
          sequence,
        }),
      );
      sequence += 1;
      continue;
    }

    if (isToolUIPart(part)) {
      const tool_name = resolveToolName(partObject, String(getToolName(part) || ""));
      const inputText = stringifyForDisplay(extractToolCallInput(partObject));
      events.push(
        toUiMessageEvent({
          message,
          role: "tool-call",
          text: inputText || "(empty)",
          sequence,
          tool_name,
        }),
      );
      sequence += 1;

      const output = extractToolResultOutput(partObject);
      if (output !== undefined) {
        events.push(
          toUiMessageEvent({
            message,
            role: "tool-result",
            text: stringifyForDisplay(output) || "(empty)",
            sequence,
            tool_name,
          }),
        );
        sequence += 1;
      }
      continue;
    }
  }

  // 关键点（中文）：assistant 若没有文本 part，也要保留一条可见事件，避免 control UI 空白。
  if (events.length === 0) {
    events.push(
      toUiMessageEvent({
        message,
        role: "assistant",
        text: resolveUiMessageText(message),
        sequence: 0,
      }),
    );
  }

  return events;
}

/**
 * 读取 session 消息文件。
 */
export async function loadSessionMessagesFromFile(
  filePath: string,
): Promise<SessionRecordV1[]> {
  if (!(await fs.pathExists(filePath))) return [];
  const raw = await fs.readFile(filePath, "utf-8");
  const lines = raw.split("\n").filter(Boolean);
  const out: SessionRecordV1[] = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line) as SessionRecordV1;
      if (!item || typeof item !== "object") continue;
      const candidate = item as { type?: unknown; role?: unknown };
      if (
        candidate.type !== "action" &&
        candidate.role !== "user" &&
        candidate.role !== "assistant"
      ) {
        continue;
      }
      out.push(item);
    } catch {
      // 关键点（中文）：单行损坏不应影响整体可读性。
    }
  }
  return out;
}

/**
 * 读取适合摘要展示的消息预览文本。
 */
export function resolveUiMessagePreview(message: SessionRecordV1): string {
  return resolveUiMessageText(message);
}
