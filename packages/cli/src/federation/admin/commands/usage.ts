/**
 * Admin Usage 管理命令。
 */

import { EmbassyAdmin } from "@downcity/federation";
import { t } from "@/shared/CliLocale.js";
import { adminErrorMessage, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

export async function manageUsage(a: EmbassyAdmin, _baseUrl: string, runtime: admin_tui_runtime): Promise<void> {
  const svc = a.service("usage");
  while (true) {
    const act = await runtime.select(t({ zh: "用量统计", en: "Usage analytics" }), [
        {
          label: t({ zh: "查看活跃概览", en: "Activity overview" }),
          value: "overview",
          hint: t({
            zh: "查看最近 30 天活跃用户、DAU、WAU、MAU、调用量、Token 与 Credits。",
            en: "View active users, DAU, WAU, MAU, calls, tokens, and Credits for the latest 30 days.",
          }),
        },
        {
          label: t({ zh: "查看用户用量", en: "User usage" }),
          value: "users",
          hint: t({
            zh: "按用户查看调用、Token、Credits、成功率和最后活跃时间。",
            en: "Inspect calls, tokens, Credits, success rate, and last active time by user.",
          }),
        },
        { label: t({ zh: "导航", en: "Navigation" }), value: "__section_navigation__", disabled: true },
        {
          label: t({ zh: "返回", en: "Back" }),
          value: "back",
          hint: t({ zh: "返回 Admin 管理菜单", en: "Return to Admin management" }),
        },
      ]);
    if (!act || act === "back") return;

    try {
      const query = build_usage_query();
      if (act === "overview") {
        const b = await runtime.with_loading(t({ zh: "活跃概览", en: "Activity overview" }), async () => await svc.get<Record<string, unknown>>(`admin/overview?${query}`));
        const activity = read_record(b.activity);
        const summary = read_record(b.summary);
        await runtime.show_table({
          title: t({ zh: "最近 30 天 Usage", en: "Latest 30-day Usage" }),
          columns: [t({ zh: "指标", en: "Metric" }), t({ zh: "值", en: "Value" })],
          rows: [
            { cells: ["DAU", String(activity.daily_active_users ?? 0)] },
            { cells: ["WAU", String(activity.weekly_active_users ?? 0)] },
            { cells: ["MAU", String(activity.monthly_active_users ?? 0)] },
            { cells: [t({ zh: "范围活跃", en: "Range active" }), String(activity.range_active_users ?? 0)] },
            { cells: [t({ zh: "调用", en: "Executions" }), String(summary.execution_count ?? 0)] },
            { cells: ["Total Tokens", String(summary.total_tokens ?? 0)] },
            { cells: ["Credits", String(summary.credits_used ?? 0)] },
          ],
        });
      } else {
        const b = await runtime.with_loading(t({ zh: "用户用量", en: "User usage" }), async () => await svc.get<{ items: Array<Record<string, unknown>> }>(`admin/users?${query}`));
        await runtime.show_table({
          title: t({ zh: "用户用量", en: "User usage" }),
          columns: ["User ID", t({ zh: "调用", en: "Calls" }), "Tokens", "Credits", t({ zh: "成功率", en: "Success" }), t({ zh: "最后活跃", en: "Last active" })],
          rows: b.items.map((item) => ({
            cells: [String(item.user_id ?? ""), String(item.execution_count ?? 0), String(item.total_tokens ?? 0), String(item.credits_used ?? 0), format_rate(item.success_rate), String(item.last_active_at ?? "").slice(0, 19)],
          })),
          empty_message: t({ zh: "暂无用户用量。", en: "No user usage." }),
        });
      }
    } catch (e) {
      rethrowAdminAuthError(e);
      await runtime.show_message("error", adminErrorMessage(e));
    }
  }
}

function build_usage_query(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const to = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const from_date = new Date(`${to}T00:00:00.000Z`);
  from_date.setUTCDate(from_date.getUTCDate() - 29);
  return new URLSearchParams({ from: from_date.toISOString().slice(0, 10), to, timezone }).toString();
}

function read_record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function format_rate(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "-";
}
