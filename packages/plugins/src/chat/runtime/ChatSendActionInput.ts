/**
 * Chat send action 输入映射。
 *
 * 关键点（中文）
 * - 专门处理 `chat send` 的 CLI/API payload 标准化。
 * - frontmatter metadata 与 `<file>` 协议在这里转换为统一正文。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue } from "@downcity/agent";
import type { PluginActionCommandInput } from "@downcity/agent";
import type { ChatSendActionPayload } from "@/chat/types/ChatPluginActionPayload.js";
import {
  build_chat_message_text,
  parse_chat_message_markup,
} from "@downcity/agent";
import { parseChatSendOptionsFromMetadata } from "@/chat/runtime/ChatSendMetadata.js";
import {
  normalizeChatSendText,
  resolveChatKey,
} from "@/chat/Action.js";
import { getBooleanOpt, getStringOpt } from "./ChatActionInputSupport.js";

/**
 * 解析非负整数 option。
 */
function parseNonNegativeIntOptionOrThrow(
  value: string,
  fieldName: string,
): number {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${fieldName} is required`);
  }
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return parsed;
}

/**
 * 判断 ISO datetime 是否缺少时区。
 */
function looksLikeIsoDatetimeWithoutTimezone(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  const isoLike = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text);
  if (!isoLike) return false;
  return !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text);
}

/**
 * 解析定时发送时间。
 *
 * 支持格式（中文）
 * - Unix 时间戳：秒或毫秒（纯数字）
 * - ISO 时间字符串：例如 `2026-03-05T20:30:00+08:00`
 */
function parseSendTimeOptionOrThrow(value: string, fieldName: string): number {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${fieldName} is required`);
  }

  if (/^\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid ${fieldName}: ${value}`);
    }
    // 关键点（中文）：10 位通常是秒级时间戳，统一转换为毫秒。
    return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
  }
  if (looksLikeIsoDatetimeWithoutTimezone(text)) {
    throw new Error(
      `Invalid ${fieldName}: ${value}. ISO datetime must include timezone offset (e.g. +08:00 or Z).`,
    );
  }

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${fieldName}: ${value}. Use Unix timestamp (seconds/ms) or ISO datetime.`,
    );
  }
  return parsed;
}

/**
 * 解析 chat send 正文协议。
 */
function parseChatSendTextProtocol(params: {
  rawText: string;
  explicitChatKey?: string;
  explicitDelayMs?: number;
  explicitSendAtMs?: number;
  explicitReplyToMessage?: boolean;
  explicitMessageId?: string;
}): ChatSendActionPayload {
  const parsed = parse_chat_message_markup(normalizeChatSendText(params.rawText));
  const metadataOptions = parseChatSendOptionsFromMetadata({
    metadata: parsed.metadata,
    strict: true,
  });

  const delay_ms =
    typeof params.explicitDelayMs === "number"
      ? params.explicitDelayMs
      : metadataOptions.delay_ms;
  const send_at_ms =
    typeof params.explicitSendAtMs === "number"
      ? params.explicitSendAtMs
      : metadataOptions.send_at_ms;
  if (typeof delay_ms === "number" && typeof send_at_ms === "number") {
    throw new Error("`delay` and `time` cannot be used together.");
  }

  const chat_key = resolveChatKey({
    chat_key: params.explicitChatKey || metadataOptions.chat_key,
  });
  const message_id = String(
    params.explicitMessageId || metadataOptions.message_id || "",
  ).trim();
  const reply_to_message =
    params.explicitReplyToMessage === true ||
    metadataOptions.reply_to_message === true;

  return {
    text: build_chat_message_text({
      segments: parsed.segments,
    }),
    ...(chat_key ? { chat_key } : {}),
    ...(typeof delay_ms === "number" ? { delay_ms } : {}),
    ...(typeof send_at_ms === "number" ? { send_at_ms } : {}),
    ...(reply_to_message ? { reply_to_message: true } : {}),
    ...(message_id ? { message_id } : {}),
  };
}

/**
 * 解析 `chat send` 的命令输入。
 *
 * 关键点（中文）
 * - `--text / --stdin / --text-file` 三选一
 * - 文本读取失败直接抛错，由上层统一输出
 */
export async function mapChatSendCommandInput(
  input: PluginActionCommandInput,
): Promise<ChatSendActionPayload> {
  const explicitText = getStringOpt(input.opts, "text");
  const useStdin = getBooleanOpt(input.opts, "stdin");
  const textFile = getStringOpt(input.opts, "textFile");
  const inputSourcesCount =
    (explicitText ? 1 : 0) + (useStdin ? 1 : 0) + (textFile ? 1 : 0);

  if (inputSourcesCount !== 1) {
    throw new Error(
      "Exactly one text source is required: use one of --text, --stdin, or --text-file.",
    );
  }

  let text = explicitText;
  if (useStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else if (textFile) {
    const filePath = path.resolve(process.cwd(), textFile);
    text = await fs.readFile(filePath, "utf8");
  }

  const delayRaw = getStringOpt(input.opts, "delay");
  const timeRaw = getStringOpt(input.opts, "time");
  const reply_to_message = getBooleanOpt(input.opts, "reply");
  const message_id = getStringOpt(input.opts, "message_id");
  const delay_ms = delayRaw
    ? parseNonNegativeIntOptionOrThrow(delayRaw, "delay")
    : undefined;
  const send_at_ms = timeRaw ? parseSendTimeOptionOrThrow(timeRaw, "time") : undefined;
  if (typeof delay_ms === "number" && typeof send_at_ms === "number") {
    throw new Error("`--delay` and `--time` cannot be used together.");
  }
  const payload = parseChatSendTextProtocol({
    rawText: text,
    explicitChatKey: getStringOpt(input.opts, "chat_key"),
    ...(typeof delay_ms === "number" ? { explicitDelayMs: delay_ms } : {}),
    ...(typeof send_at_ms === "number" ? { explicitSendAtMs: send_at_ms } : {}),
    ...(reply_to_message ? { explicitReplyToMessage: true } : {}),
    ...(message_id ? { explicitMessageId: message_id } : {}),
  });
  const chat_key = resolveChatKey({
    chat_key: payload.chat_key,
  });
  if (!chat_key) {
    throw new Error(
      "Missing chat_key. Provide --chat-key or ensure DC_CTX_CHAT_KEY is injected in current shell context.",
    );
  }

  return {
    text: payload.text,
    chat_key,
    ...(typeof payload.delay_ms === "number" ? { delay_ms: payload.delay_ms } : {}),
    ...(typeof payload.send_at_ms === "number" ? { send_at_ms: payload.send_at_ms } : {}),
    ...(payload.reply_to_message === true ? { reply_to_message: true } : {}),
    ...(payload.message_id ? { message_id: payload.message_id } : {}),
  };
}

/**
 * 解析 `chat send` 的 API 输入。
 */
export function mapChatSendApiInput(body: JsonValue): ChatSendActionPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid JSON body");
  }
  const payload = body as JsonObject;
  const delayRaw = payload.delay_ms ?? payload.delay;
  const timeRaw = payload.send_at_ms ?? payload.sendAt ?? payload.time;
  const replyRaw = payload.reply_to_message ?? payload.reply;
  const delayText =
    typeof delayRaw === "string" || typeof delayRaw === "number"
      ? String(delayRaw).trim()
      : "";
  const timeText =
    typeof timeRaw === "string" || typeof timeRaw === "number"
      ? String(timeRaw).trim()
      : "";
  const delay_ms = delayText
    ? parseNonNegativeIntOptionOrThrow(delayText, "delay_ms")
    : undefined;
  const send_at_ms = timeText
    ? parseSendTimeOptionOrThrow(timeText, "send_at_ms")
    : undefined;
  if (typeof delay_ms === "number" && typeof send_at_ms === "number") {
    throw new Error("`delay_ms` and `send_at_ms` cannot be used together.");
  }
  return parseChatSendTextProtocol({
    rawText: String(payload.text ?? ""),
    explicitChatKey:
      typeof payload.chat_key === "string" ? payload.chat_key.trim() : undefined,
    ...(typeof delay_ms === "number" ? { explicitDelayMs: delay_ms } : {}),
    ...(typeof send_at_ms === "number" ? { explicitSendAtMs: send_at_ms } : {}),
    ...(replyRaw === true ? { explicitReplyToMessage: true } : {}),
    ...(typeof payload.message_id === "string" || typeof payload.message_id === "number"
      ? { explicitMessageId: String(payload.message_id).trim() }
      : {}),
  });
}
