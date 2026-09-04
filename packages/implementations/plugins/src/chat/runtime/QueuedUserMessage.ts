/**
 * QueuedUserMessage：构造入队执行消息文本。
 *
 * 关键点（中文）
 * - 统一生成 `<info>...</info>` 头部，供模型读取用户与本次请求元信息。
 * - chat 路由环境不再放入 `<info>`，改由 system prompt 注入。
 * - 供 chat 入站执行与其他复用入口共用，避免重复实现。
 */

import type { QueuedUserInfoInput } from "@/chat/types/ChatPromptContext.js";
import {
  format_date_time_in_timezone,
  resolve_runtime_timezone,
} from "@downcity/agent";

function normalizeInfoValue(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (!text) return "";
  return text.replace(/</g, "&#60;").replace(/>/g, "&#62;");
}

function normalizeReceivedAtIso(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  const date = raw ? new Date(raw) : new Date();
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

/**
 * 构造“入队 user message”文本。
 *
 * 说明（中文）
 * - 顶部 `<info>` 为内部语义块，仅记录 user/request 元信息。
 * - 正文为用户原始输入（可为空）。
 */
export function buildQueuedUserMessageWithInfo(params: {
  text: string;
} & QueuedUserInfoInput): string {
  const runtimeTimezone = resolve_runtime_timezone();
  const receivedAtIso = normalizeReceivedAtIso(params.receivedAt);
  const receivedAtDate = new Date(receivedAtIso);
  const infoLines = [
    `message_id: ${normalizeInfoValue(params.message_id || "unknown")}`,
    `user_id: ${normalizeInfoValue(params.user_id || "unknown")}`,
    `username: ${normalizeInfoValue(params.username || "unknown")}`,
    `received_at: ${normalizeInfoValue(receivedAtIso)}`,
    `received_at_local: ${normalizeInfoValue(format_date_time_in_timezone(receivedAtDate, runtimeTimezone))}`,
    `runtime_timezone: ${normalizeInfoValue(runtimeTimezone)}`,
  ];
  if (normalizeInfoValue(params.userTimezone)) {
    infoLines.push(`user_timezone: ${normalizeInfoValue(params.userTimezone)}`);
  }
  const infoBlock = `<info>\n${infoLines.join("\n")}\n</info>`;
  const body = String(params.text ?? "").trim();
  if (!body) return infoBlock;
  return `${infoBlock}\n\n${body}`;
}
