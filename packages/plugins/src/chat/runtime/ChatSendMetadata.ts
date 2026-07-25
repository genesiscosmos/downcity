/**
 * Chat send frontmatter metadata 解析工具。
 *
 * 关键点（中文）
 * - frontmatter 中的字段语义与 `downcity chat send` 参数保持一致。
 * - direct 模式也复用同一解析逻辑，避免 metadata 协议分叉。
 */

import type { ChatMessageSendOptions } from "@downcity/agent";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function pickMetadataValue(
  metadata: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(metadata, key)) {
      return metadata[key];
    }
  }
  return undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  if (!text) return undefined;
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return undefined;
}

function parseOptionalMessageId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value)) {
    const text = String(Math.trunc(value)).trim();
    return text ? text : undefined;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text ? text : undefined;
  }
  return undefined;
}

function looksLikeIsoDatetimeWithoutTimezone(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  const isoLike = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text);
  if (!isoLike) return false;
  return !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text);
}

function parseNonNegativeInt(
  value: unknown,
  fieldName: string,
  strict: boolean,
): number | undefined {
  const text = normalizeText(value);
  if (!text) return undefined;
  if (!/^\d+$/.test(text)) {
    if (strict) {
      throw new Error(`Invalid ${fieldName}: ${String(value)}`);
    }
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    if (strict) {
      throw new Error(`Invalid ${fieldName}: ${String(value)}`);
    }
    return undefined;
  }
  return parsed;
}

function parseSendAtMs(
  value: unknown,
  fieldName: string,
  strict: boolean,
): number | undefined {
  const text = normalizeText(value);
  if (!text) return undefined;

  if (/^\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
      if (strict) {
        throw new Error(`Invalid ${fieldName}: ${String(value)}`);
      }
      return undefined;
    }
    return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
  }

  if (looksLikeIsoDatetimeWithoutTimezone(text)) {
    if (strict) {
      throw new Error(
        `Invalid ${fieldName}: ${String(value)}. ISO datetime must include timezone offset (e.g. +08:00 or Z).`,
      );
    }
    return undefined;
  }

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    if (strict) {
      throw new Error(
        `Invalid ${fieldName}: ${String(value)}. Use Unix timestamp (seconds/ms) or ISO datetime.`,
      );
    }
    return undefined;
  }
  return parsed;
}

/**
 * 从 frontmatter metadata 中解析发送参数。
 *
 * 说明（中文）
 * - `strict=true` 时，非法 delay/time 会直接抛错，适用于 CLI/API 输入。
 * - `strict=false` 时，非法字段会被忽略，适用于 direct 模式的宽容解析。
 */
export function parseChatSendOptionsFromMetadata(params: {
  metadata: Record<string, unknown>;
  strict?: boolean;
}): ChatMessageSendOptions {
  const metadata =
    params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata)
      ? params.metadata
      : {};
  const strict = params.strict === true;

  const chat_key = normalizeText(
    pickMetadataValue(metadata, ["chat_key", "chat-key"]),
  );
  const delay_ms = parseNonNegativeInt(
    pickMetadataValue(metadata, ["delay_ms", "delay-ms", "delay"]),
    "delay",
    strict,
  );
  const send_at_ms = parseSendAtMs(
    pickMetadataValue(metadata, ["send_at_ms", "send-at-ms", "sendAt", "send-at", "time"]),
    "time",
    strict,
  );
  if (typeof delay_ms === "number" && typeof send_at_ms === "number") {
    throw new Error("`delay` and `time` cannot be used together.");
  }

  const explicitMessageId = parseOptionalMessageId(
    pickMetadataValue(metadata, ["message_id", "message-id"]),
  );
  const replyRaw = pickMetadataValue(metadata, ["reply"]);
  const replyAsBoolean = parseBoolean(replyRaw);
  const replyAsMessageId =
    explicitMessageId || (replyAsBoolean === undefined ? parseOptionalMessageId(replyRaw) : undefined);
  const reply_to_message =
    replyAsBoolean === true || typeof replyAsMessageId === "string";

  return {
    ...(chat_key ? { chat_key } : {}),
    ...(typeof delay_ms === "number" ? { delay_ms } : {}),
    ...(typeof send_at_ms === "number" ? { send_at_ms } : {}),
    ...(reply_to_message ? { reply_to_message: true } : {}),
    ...(typeof replyAsMessageId === "string" ? { message_id: replyAsMessageId } : {}),
  };
}
