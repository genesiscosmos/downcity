/**
 * Feedback 服务输入校验与数据整理工具。
 *
 * 关键说明（中文）
 * - HTTP 边界传入 unknown，所有字段必须先经过这里标准化
 * - 查询阶段使用 FederationTableApi 的等值能力读取候选集，再在内存排序截断
 * - JSON 上下文序列化失败时退化为 `{}`，避免用户反馈因为 meta 异常丢失
 */

import { httpError } from "@downcity/federation";
import type { FeedbackMessage, FeedbackStatus } from "./types.js";

const FEEDBACK_STATUSES: readonly FeedbackStatus[] = [
  "open",
  "reviewing",
  "replied",
  "closed",
];

/**
 * 读取必填字符串。
 */
export function readRequiredText(value: unknown, label: string, max_length: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw httpError(400, `${label} is required`);
  if (normalized.length > max_length) throw httpError(400, `${label} is too long`);
  return normalized;
}

/**
 * 读取可选字符串。
 */
export function readOptionalText(value: unknown, label: string, max_length: number, fallback = ""): string {
  const normalized = String(value ?? fallback).trim();
  if (normalized.length > max_length) throw httpError(400, `${label} is too long`);
  return normalized;
}

/**
 * 读取反馈 ID。
 */
export function readFeedbackId(value: unknown): string {
  return readRequiredText(value, "feedback_id", 200);
}

/**
 * 标准化反馈处理状态。
 */
export function normalizeFeedbackStatus(value: unknown): FeedbackStatus {
  const normalized = String(value ?? "").trim();
  if (FEEDBACK_STATUSES.includes(normalized as FeedbackStatus)) {
    return normalized as FeedbackStatus;
  }
  throw httpError(400, "status must be one of: open, reviewing, replied, closed");
}

/**
 * 标准化可选状态过滤条件。
 */
export function normalizeOptionalFeedbackStatus(value: unknown): FeedbackStatus | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return normalizeFeedbackStatus(value);
}

/**
 * 标准化列表上限。
 */
export function normalizeLimit(value: unknown, default_limit: number, max_limit: number): number {
  const normalized = Number(value ?? default_limit);
  if (!Number.isInteger(normalized) || normalized <= 0) return default_limit;
  return Math.min(normalized, max_limit);
}

/**
 * 标准化可选等值过滤文本。
 */
export function normalizeOptionalFilter(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  if (normalized.length > 500) throw httpError(400, `${label} is too long`);
  return normalized;
}

/**
 * 安全序列化反馈上下文。
 */
export function stringifyFeedbackMeta(value: unknown): string {
  try {
    const serialized = JSON.stringify(value ?? {});
    return serialized === undefined ? "{}" : serialized;
  } catch {
    return "{}";
  }
}

/**
 * 生成反馈 ID。
 */
export function randomFeedbackId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const suffix = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
  return `fb_${suffix}`;
}

/**
 * 解析反馈消息行。
 */
export function parseFeedbackMessage(row: FeedbackMessage): FeedbackMessage {
  return {
    feedback_id: String(row.feedback_id),
    bureau_id: String(row.bureau_id),
    user_id: String(row.user_id),
    message: String(row.message),
    contact: String(row.contact ?? ""),
    status: normalizeFeedbackStatus(row.status),
    reply: String(row.reply ?? ""),
    reply_by: String(row.reply_by ?? ""),
    replied_at: String(row.replied_at ?? ""),
    metadata_json: String(row.metadata_json ?? "{}"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * 按创建时间倒序排列并截断。
 */
export function sortAndLimitFeedback(rows: FeedbackMessage[], limit: number): FeedbackMessage[] {
  return rows
    .map(parseFeedbackMessage)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}
