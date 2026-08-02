/**
 * Admin Usage 管理命令。
 */

import { FederationAdmin } from "@downcity/city";
import { t } from "@/shared/CliLocale.js";
import { adminErrorMessage, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

export async function manageUsage(a: FederationAdmin, _baseUrl: string, runtime: admin_tui_runtime): Promise<void> {
  const svc = a.service("usage");
  while (true) {
    const act = await runtime.select(t({ zh: "用量统计", en: "Usage analytics" }), [
        {
          label: t({ zh: "查看调用事件", en: "List events" }),
          value: "events",
          hint: t({
            zh: "查看最近 service 调用明细，包含 Bureau/产品、service、状态和创建时间。",
            en: "View recent service-call events with Bureau/product, service, status, and creation time.",
          }),
        },
        {
          label: t({ zh: "查看汇总统计", en: "Summary" }),
          value: "summary",
          hint: t({
            zh: "按 Bureau/产品、service 和状态聚合调用次数，用于观察消耗趋势和失败分布。",
            en: "Aggregate call counts by Bureau/product, service, and status to inspect usage trends and failures.",
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
      if (act === "events") {
        const b = await runtime.with_loading(t({ zh: "用量事件", en: "Usage Events" }), async () => await svc.get<{ items: { bureau_id: string; service: string; status: string; created_at: string }[] }>("events"));
        const items = b.items.slice(-20);
        await runtime.show_table({
          title: t({ zh: `${items.length} 条用量事件`, en: `${items.length} Usage Events` }),
          columns: [t({ zh: "创建时间", en: "Created" }), "Bureau", t({ zh: "服务", en: "Service" }), t({ zh: "状态", en: "Status" })],
          rows: items.map((e) => ({
            cells: [e.created_at.slice(0, 19), e.bureau_id, e.service, e.status],
          })),
          empty_message: t({ zh: "暂无用量事件。", en: "No usage events." }),
        });
      } else {
        const b = await runtime.with_loading(t({ zh: "用量汇总", en: "Usage Summary" }), async () => await svc.get<{ items: { bureau_id: string; service: string; status: string; count: number }[] }>("summary"));
        await runtime.show_table({
          title: t({ zh: "用量汇总", en: "Usage Summary" }),
          columns: ["City", t({ zh: "服务", en: "Service" }), t({ zh: "数量", en: "Count" }), t({ zh: "状态", en: "Status" })],
          rows: b.items.map((s) => ({
            cells: [s.bureau_id, s.service, String(s.count), s.status],
          })),
          empty_message: t({ zh: "暂无用量汇总。", en: "No usage summary." }),
        });
      }
    } catch (e) {
      rethrowAdminAuthError(e);
      await runtime.show_message("error", adminErrorMessage(e));
    }
  }
}
