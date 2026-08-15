/** Desktop 用量周期、趋势与热力图聚合测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopUsageDay } from "../src/common/types/DesktopApi.ts";
import {
  build_usage_heatmap,
  build_usage_trend,
  sum_heatmap_credits,
  summarize_usage_period,
} from "../src/renderer/lib/usage/usage_metrics.ts";

function day(date: string, credits_used: number, total_tokens: number): DesktopUsageDay {
  return {
    date,
    credits_used,
    total_tokens,
    execution_count: total_tokens > 0 ? 1 : 0,
    image_count: 0,
  };
}

test("汇总今天、当前自然周和当前自然月", () => {
  const days = [
    day("2026-07-31", 50, 25),
    day("2026-08-03", 100, 50),
    day("2026-08-04", 300, 75),
  ];

  assert.deepEqual(summarize_usage_period(days, "day", "2026-08-04"), { credits_used: 300, total_tokens: 75 });
  assert.deepEqual(summarize_usage_period(days, "week", "2026-08-04"), { credits_used: 400, total_tokens: 125 });
  assert.deepEqual(summarize_usage_period(days, "month", "2026-08-04"), { credits_used: 400, total_tokens: 125 });
});

test("按自然周补齐热力图边界并计算活动等级", () => {
  const heatmap = build_usage_heatmap([
    day("2026-08-03", 100, 50),
    day("2026-08-04", 300, 75),
  ], "2026-08-04", 2);
  const heatmap_days = heatmap.weeks.flatMap((week) => week.days);

  assert.equal(heatmap.weeks.every((week) => week.days.length === 7), true);
  assert.equal(heatmap_days.find((item) => item.date === "2026-08-03")?.level, 2);
  assert.equal(heatmap_days.find((item) => item.date === "2026-08-04")?.level, 4);
  assert.equal(heatmap_days.find((item) => item.date === "2026-08-05")?.in_range, false);
  assert.equal(sum_heatmap_credits(heatmap), 400);
});

test("分别构建最近 30 日、12 周与 12 月趋势", () => {
  const days = [
    day("2026-07-31", 50, 25),
    day("2026-08-03", 100, 50),
    day("2026-08-04", 300, 75),
  ];
  const daily = build_usage_trend(days, "day", "2026-08-04");
  const weekly = build_usage_trend(days, "week", "2026-08-04");
  const monthly = build_usage_trend(days, "month", "2026-08-04");

  assert.equal(daily.length, 30);
  assert.deepEqual(daily.at(-1), { key: "2026-08-04", start_date: "2026-08-04", end_date: "2026-08-04", credits_used: 300 });
  assert.deepEqual(weekly.at(-1), { key: "2026-08-03", start_date: "2026-08-03", end_date: "2026-08-09", credits_used: 400 });
  assert.deepEqual(monthly.at(-1), { key: "2026-08", start_date: "2026-08-01", end_date: "2026-08-31", credits_used: 400 });
});
