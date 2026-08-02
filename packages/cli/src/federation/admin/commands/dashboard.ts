/**
 * Admin 用户系统 Dashboard 命令。
 *
 * 关键说明（中文）
 * - 这是 fed CLI 自己的运营视图，直接读取现有 admin 数据并在 CLI 内计算。
 * - 不引入 Dashboard adapter，也不要求 Federation 后端提供跨 service 聚合 API。
 * - 命令层只负责 TUI 交互，数据读取、指标计算和展示格式分别放在 dashboard 模块中。
 */

import { FederationAdmin } from "@downcity/city";
import { fetch_dashboard_raw_data } from "@/federation/admin/dashboard/dashboard-data.js";
import { dashboard_rows, dashboard_view_title, range_label } from "@/federation/admin/dashboard/dashboard-format.js";
import { build_dashboard_snapshot } from "@/federation/admin/dashboard/dashboard-metrics.js";
import { adminErrorMessage, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import { t } from "@/shared/CliLocale.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";
import type { dashboard_range, dashboard_raw_data, dashboard_snapshot, dashboard_view } from "@/federation/types/AdminDashboard.js";

/**
 * 打开用户系统 Dashboard。
 */
export async function manageDashboard(a: FederationAdmin, _base_url: string, runtime: admin_tui_runtime): Promise<void> {
  let raw_data: dashboard_raw_data | undefined;
  let snapshot: dashboard_snapshot | undefined;
  let range: dashboard_range = "30d";

  while (true) {
    const action = await runtime.select(t({ zh: "用户系统 Dashboard", en: "User system dashboard" }), [
      { label: t({ zh: `概览 (${range_label(range)})`, en: `Overview (${range_label(range)})` }), value: "overview" },
      { label: t({ zh: "用户", en: "Users" }), value: "users" },
      { label: t({ zh: "活跃", en: "Activity" }), value: "activity" },
      { label: t({ zh: "付费", en: "Payment" }), value: "payment" },
      { label: t({ zh: "收入", en: "Revenue" }), value: "revenue" },
      { label: t({ zh: "用量", en: "Usage" }), value: "usage" },
      { label: t({ zh: "健康", en: "Health" }), value: "health" },
      { label: t({ zh: "服务状态", en: "Service status" }), value: "availability" },
      { label: t({ zh: "操作", en: "Actions" }), value: "__section_actions__", disabled: true },
      { label: t({ zh: `切换范围：${range_label(range)}`, en: `Range: ${range_label(range)}` }), value: "range" },
      { label: t({ zh: "刷新", en: "Refresh" }), value: "refresh" },
      { label: t({ zh: "导航", en: "Navigation" }), value: "__section_navigation__", disabled: true },
      { label: t({ zh: "返回", en: "Back" }), value: "back" },
    ]);

    if (!action || action === "back") return;

    try {
      if (action === "range") {
        const next_range = await select_range(runtime, range);
        if (next_range) {
          range = next_range;
          snapshot = raw_data ? build_dashboard_snapshot(raw_data, range) : undefined;
          if (snapshot) await show_dashboard_view(runtime, "overview", snapshot);
        }
        continue;
      }

      if (action === "refresh" || !raw_data || !snapshot) {
        raw_data = await runtime.with_loading(
          t({ zh: "读取用户系统 Dashboard", en: "Loading user system dashboard" }),
          async () => await fetch_dashboard_raw_data(a),
        );
        snapshot = build_dashboard_snapshot(raw_data, range);
      }

      const view = action === "refresh" ? "overview" : action as dashboard_view;
      await show_dashboard_view(runtime, view, snapshot);
    } catch (error) {
      rethrowAdminAuthError(error);
      await runtime.show_message("error", adminErrorMessage(error));
    }
  }
}

/**
 * 选择 Dashboard 时间范围。
 */
async function select_range(runtime: admin_tui_runtime, current_range: dashboard_range): Promise<dashboard_range | undefined> {
  const action = await runtime.select(t({ zh: "选择统计范围", en: "Select range" }), [
    range_option("today", current_range),
    range_option("7d", current_range),
    range_option("30d", current_range),
    range_option("all", current_range),
    { label: t({ zh: "导航", en: "Navigation" }), value: "__section_navigation__", disabled: true },
    { label: t({ zh: "返回", en: "Back" }), value: "back" },
  ]);

  if (!action || action === "back") return undefined;
  return action as dashboard_range;
}

/**
 * 构建范围选项。
 */
function range_option(range: dashboard_range, current_range: dashboard_range): { label: string; value: string; hint?: string } {
  const current_mark = range === current_range ? t({ zh: "（当前）", en: " (current)" }) : "";
  return {
    label: `${range_label(range)}${current_mark}`,
    value: range,
    hint: range_hint(range),
  };
}

/**
 * 范围说明。
 */
function range_hint(range: dashboard_range): string {
  if (range === "today") return t({ zh: "从本地时间今日 00:00 开始统计。", en: "Count from local midnight today." });
  if (range === "7d") return t({ zh: "统计最近 7 天窗口。", en: "Count the latest 7-day window." });
  if (range === "30d") return t({ zh: "统计最近 30 天窗口。", en: "Count the latest 30-day window." });
  return t({ zh: "统计已读取的全部数据。", en: "Count all fetched data." });
}

/**
 * 展示 Dashboard 视图。
 */
async function show_dashboard_view(runtime: admin_tui_runtime, view: dashboard_view, snapshot: dashboard_snapshot): Promise<void> {
  await runtime.show_table({
    title: dashboard_view_title(view, snapshot.range),
    columns: [
      t({ zh: "分组", en: "Group" }),
      t({ zh: "指标", en: "Metric" }),
      t({ zh: "值", en: "Value" }),
    ],
    rows: dashboard_rows(view, snapshot),
    empty_message: t({ zh: "暂无 Dashboard 数据。", en: "No dashboard data." }),
  });
}
