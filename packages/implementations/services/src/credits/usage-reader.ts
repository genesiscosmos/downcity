/**
 * Credits 用量只读投影。
 *
 * 本模块只从已入账 Charge 生成用户与管理端统计，不参与 Card 状态或 Transaction
 * 写入，因此可以独立于账务编排演进和验证。
 */

import {
  create_usage_date_formatter,
  create_usage_utc_envelope,
  format_usage_local_date,
  read_usage_integer,
  type AdminUsageQuery,
  type ServiceDatabaseContext,
  type UserDailyUsageQuery,
} from "@downcity/federation";
import { raw_all, raw_first } from "./raw.js";
import { TRANSACTION_TABLE } from "./schema.js";
import type {
  AdminCreditsUsageResult,
  CreditsDailyUsageBucket,
  CreditsDailyUsageResult,
} from "./types/Usage.js";

/** 按用户、当地日期范围与时区聚合已入账 Credits 消费。 */
export async function aggregate_user_daily_charges(
  database: ServiceDatabaseContext,
  input: UserDailyUsageQuery,
): Promise<CreditsDailyUsageResult> {
  const envelope = create_usage_utc_envelope(input.from, input.to);
  const rows = await raw_all<{ credits: unknown; applied_at: string }>(database, [
    `SELECT credits, applied_at FROM ${TRANSACTION_TABLE}`,
    "WHERE user_id = ? AND kind = 'charge' AND status = 'applied' AND credits > 0",
    "AND applied_at >= ? AND applied_at < ? ORDER BY applied_at ASC",
  ].join(" "), [input.user_id, envelope.from_utc, envelope.to_utc_exclusive]);
  const first = await raw_first<{ applied_at: string }>(database, [
    `SELECT applied_at FROM ${TRANSACTION_TABLE}`,
    "WHERE user_id = ? AND kind = 'charge' AND status = 'applied' AND credits > 0",
    "ORDER BY applied_at ASC LIMIT 1",
  ].join(" "), [input.user_id]);
  const formatter = create_usage_date_formatter(input.timezone);
  const by_date = new Map<string, CreditsDailyUsageBucket>();
  for (const row of rows) {
    const date = format_usage_local_date(formatter, row.applied_at);
    if (date < input.from || date > input.to) continue;
    const bucket = by_date.get(date) ?? { date, used: 0, charge_count: 0 };
    bucket.used += read_usage_integer(row.credits);
    bucket.charge_count += 1;
    by_date.set(date, bucket);
  }
  return {
    data_available_from: first
      ? format_usage_local_date(formatter, first.applied_at)
      : null,
    days: [...by_date.values()].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

/** 按日期范围聚合 Federation 全部用户的已入账 Credits 消费。 */
export async function aggregate_admin_charges(
  database: ServiceDatabaseContext,
  input: AdminUsageQuery,
): Promise<AdminCreditsUsageResult> {
  const envelope = create_usage_utc_envelope(input.from, input.to);
  const rows = await raw_all<{ user_id: string; credits: unknown; applied_at: string }>(database, [
    `SELECT user_id, credits, applied_at FROM ${TRANSACTION_TABLE}`,
    "WHERE kind = 'charge' AND status = 'applied' AND credits > 0",
    "AND applied_at >= ? AND applied_at < ? ORDER BY applied_at ASC",
  ].join(" "), [envelope.from_utc, envelope.to_utc_exclusive]);
  const formatter = create_usage_date_formatter(input.timezone);
  const users = new Map<string, { user_id: string; credits_used: number; charge_count: number }>();
  const days = new Map<string, CreditsDailyUsageBucket>();
  for (const row of rows) {
    const date = format_usage_local_date(formatter, row.applied_at);
    if (date < input.from || date > input.to) continue;
    const credits = read_usage_integer(row.credits);
    const user = users.get(row.user_id) ?? {
      user_id: row.user_id,
      credits_used: 0,
      charge_count: 0,
    };
    user.credits_used += credits;
    user.charge_count += 1;
    users.set(row.user_id, user);
    const day = days.get(date) ?? { date, used: 0, charge_count: 0 };
    day.used += credits;
    day.charge_count += 1;
    days.set(date, day);
  }
  return {
    users: [...users.values()].sort(
      (left, right) => right.credits_used - left.credits_used
        || left.user_id.localeCompare(right.user_id),
    ),
    days: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
  };
}
