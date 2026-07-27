/**
 * Credits 输入标准化与数据库行投影工具。
 */

import type {
  CreditsEphemeralCard,
  CreditsEphemeralCardStatus,
  CreditsPrimaryCard,
} from "./types/Card.js";
import type { CreditsTransaction, CreditsTransactionEntry } from "./types/Transaction.js";

/** 读取非空文本。 */
export function read_required_text(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

/** 读取可选文本。 */
export function read_text(value: unknown): string {
  return String(value ?? "").trim();
}

/** 读取正安全整数 credits。 */
export function read_credits(value: unknown, label = "credits"): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return normalized;
}

/** 读取查询条数。 */
export function read_limit(value: unknown, fallback = 100): number {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(normalized)));
}

/** 生成跨平台随机 ID。 */
export function random_id(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const value = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
  return `${prefix}_${value}`;
}

/** 根据稳定业务键生成不泄露原文的跨进程 ID。 */
export async function stable_id(prefix: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const suffix = Array.from(new Uint8Array(digest).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${suffix}`;
}

/** 稳定序列化 JSON。 */
export function stringify_json(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {});
}

/** 解析 Primary Card 数据库行。 */
export function parse_primary_card(row: Record<string, unknown>): CreditsPrimaryCard {
  return {
    kind: "primary",
    user_id: String(row.user_id ?? ""),
    credits: Number(row.credits ?? 0),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

/** 计算 Ephemeral Card 状态。 */
export function resolve_ephemeral_status(
  credits: number,
  expires_at: string,
  current_time = new Date(),
): CreditsEphemeralCardStatus {
  if (Date.parse(expires_at) <= current_time.getTime()) return "expired";
  return credits <= 0 ? "depleted" : "active";
}

/** 解析 Ephemeral Card 数据库行。 */
export function parse_ephemeral_card(row: Record<string, unknown>): CreditsEphemeralCard {
  const credits = Number(row.credits ?? 0);
  const expires_at = String(row.expires_at ?? "");
  return {
    kind: "ephemeral",
    card_id: String(row.card_id ?? ""),
    user_id: String(row.user_id ?? ""),
    name: String(row.name ?? ""),
    credits,
    expires_at,
    source: String(row.source ?? ""),
    ref: String(row.ref ?? ""),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    status: resolve_ephemeral_status(credits, expires_at),
  };
}

/** 解析 Transaction 数据库行。 */
export function parse_transaction(row: Record<string, unknown>): CreditsTransaction {
  return {
    transaction_id: String(row.transaction_id ?? ""),
    kind: String(row.kind ?? "") as CreditsTransaction["kind"],
    user_id: String(row.user_id ?? ""),
    credits: Number(row.credits ?? 0),
    status: String(row.status ?? "") as CreditsTransaction["status"],
    idempotency_key: String(row.idempotency_key ?? ""),
    source: String(row.source ?? ""),
    ref: String(row.ref ?? ""),
    note: String(row.note ?? ""),
    metadata_json: String(row.metadata_json ?? "{}"),
    created_at: String(row.created_at ?? ""),
    applied_at: row.applied_at ? String(row.applied_at) : null,
  };
}

/** 解析 Transaction Entry 数据库行。 */
export function parse_transaction_entry(row: Record<string, unknown>): CreditsTransactionEntry {
  return {
    entry_id: String(row.entry_id ?? ""),
    transaction_id: String(row.transaction_id ?? ""),
    user_id: String(row.user_id ?? ""),
    card_kind: String(row.card_kind ?? "") as CreditsTransactionEntry["card_kind"],
    card_id: String(row.card_id ?? ""),
    credits_delta: Number(row.credits_delta ?? 0),
    credits_after: Number(row.credits_after ?? 0),
    created_at: String(row.created_at ?? ""),
  };
}
