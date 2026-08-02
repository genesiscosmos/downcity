/**
 * Admin Custom Service 命令。
 */

import { FederationAdmin } from "@downcity/city";
import { t } from "@/shared/CliLocale.js";
import { adminErrorMessage, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

export async function manageCustom(a: FederationAdmin, _baseUrl: string, runtime: admin_tui_runtime): Promise<void> {
  while (true) {
    const name = await runtime.text(t({
      zh: "service id（例如 accounts、usage、payment.stripe，留空返回）",
      en: "service id (for example accounts, usage, payment.stripe; empty to go back)",
    }));
    if (!name) return;

    const act = await runtime.select(t({ zh: `服务调试：${name}`, en: `Service debugger: ${name}` }), [
        {
          label: "GET",
          value: "get",
          hint: t({
            zh: "输入 path 后以 GET 调用该 service，用于读取列表、详情或只读状态。",
            en: "Enter a path and call this service with GET to read lists, details, or status.",
          }),
        },
        {
          label: "POST",
          value: "post",
          hint: t({
            zh: "输入 JSON body 后以 POST 调用该 service action，用于调试写入或动作接口。",
            en: "Enter a JSON body and call this service action with POST to debug writes or actions.",
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
      const svc = a.service(name);
      if (act === "get") {
        const path = await runtime.text("path") ?? "";
        const result = await runtime.with_loading(`${name} GET`, async () => await svc.get(path));
        await runtime.show_json(`${name} GET ${path || "/"}`, result);
      } else {
        const raw = await runtime.text("body (JSON)") ?? "{}";
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(raw);
        } catch {
          await runtime.show_message("error", t({
            zh: "JSON body 无效",
            en: "Invalid JSON body",
          }));
          continue;
        }
        const result = await runtime.with_loading(`${name} POST`, async () => await svc.action("").invoke(body));
        await runtime.show_json(`${name} POST`, result);
      }
    } catch (e) {
      rethrowAdminAuthError(e);
      await runtime.show_message("error", adminErrorMessage(e));
    }
  }
}
