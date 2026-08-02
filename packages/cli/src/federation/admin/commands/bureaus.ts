/**
 * Federation Root Admin 的 Bureau 身份管理命令。
 *
 * Bureau 是稳定的产品身份与授权域；City 是 Agent 终端，不进入 Federation 注册表。
 */

import { FederationAdmin } from "@downcity/city";
import { t } from "@/shared/CliLocale.js";
import { adminErrorMessage, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

export async function manage_bureaus(admin: FederationAdmin, _base_url: string, runtime: admin_tui_runtime): Promise<void> {
  while (true) {
    const act = await runtime.select(t({ zh: "产品管理", en: "Products" }), [
        {
          label: t({ zh: "查看全部", en: "List all" }),
          value: "list",
          hint: t({
            zh: "查看全部产品身份及其 Bureau ID、名称和状态。",
            en: "List all product identities with Bureau ID, name, and status.",
          }),
        },
        {
          label: t({ zh: "创建产品", en: "Create product" }),
          value: "create",
          hint: t({
            zh: "创建稳定的产品身份与授权域；City 终端通过 bureau_id 连接它。",
            en: "Create a stable product identity and authorization domain used by City terminals.",
          }),
        },
        {
          label: t({ zh: "暂停产品", en: "Pause product" }),
          value: "pause",
          hint: t({
            zh: "暂停 Bureau，使其机器凭证和目标 User Token 不再被接受。",
            en: "Pause a Bureau so its machine credentials and targeted user tokens are rejected.",
          }),
        },
        {
          label: t({ zh: "启用产品", en: "Activate product" }),
          value: "activate",
          hint: t({
            zh: "恢复已暂停的 Bureau。",
            en: "Reactivate a paused Bureau.",
          }),
        },
        {
          label: t({ zh: "归档产品", en: "Archive product" }),
          value: "archive",
          hint: t({
            zh: "归档 Bureau，并撤销它的全部机器凭证。",
            en: "Archive a Bureau and revoke all of its machine credentials.",
          }),
        },
        {
          label: t({ zh: "签发 user token", en: "Issue user token" }),
          value: "token",
          hint: t({
            zh: "为指定 user_id 签发绑定到某个 Bureau 的 User Token。",
            en: "Issue a user token for a user_id targeted to a Bureau.",
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
      if (act === "list") {
        const items = await runtime.with_loading(t({ zh: "产品管理", en: "Products" }), async () => await admin.bureaus.list());
        await runtime.show_table({
          title: t({ zh: `${items.length} 个产品`, en: `${items.length} Products` }),
          columns: ["Bureau ID", t({ zh: "名称", en: "Name" }), "Server URL", t({ zh: "状态", en: "Status" })],
          rows: items.map((item) => ({
            cells: [item.bureau_id, item.name, item.server_url, item.state],
          })),
          empty_message: t({ zh: "暂无 Bureau。", en: "No bureaus." }),
        });
      } else if (act === "create") {
        const name = await runtime.text(t({ zh: "产品名称", en: "product name" }));
        if (!name) continue;
        const server_url = await runtime.text("server_url");
        if (!server_url) continue;
        const bureau_id = await runtime.text("bureau_id (optional)");
        const item = await runtime.with_loading(t({ zh: "创建产品", en: "Create product" }), async () => await admin.bureaus.create(bureau_id ? { name, server_url, bureau_id } : { name, server_url }));
        await runtime.show_message("success", t({ zh: `已创建：${item.bureau_id}`, en: `created: ${item.bureau_id}` }));
      } else if (act === "pause") {
        const id = await runtime.text("bureau_id");
        if (!id) continue;
        await runtime.with_loading(t({ zh: "暂停产品", en: "Pause product" }), async () => await admin.bureaus.pause(id));
        await runtime.show_message("success", t({ zh: `已暂停：${id}`, en: `paused: ${id}` }));
      } else if (act === "activate") {
        const id = await runtime.text("bureau_id");
        if (!id) continue;
        await runtime.with_loading(t({ zh: "启用产品", en: "Activate product" }), async () => await admin.bureaus.activate(id));
        await runtime.show_message("success", t({ zh: `已启用：${id}`, en: `activated: ${id}` }));
      } else if (act === "archive") {
        const id = await runtime.text("bureau_id");
        if (!id) continue;
        await runtime.with_loading(t({ zh: "归档产品", en: "Archive product" }), async () => await admin.bureaus.archive(id));
        await runtime.show_message("success", t({ zh: `已归档：${id}`, en: `archived: ${id}` }));
      } else if (act === "token") {
        const user_id = await runtime.text("user_id");
        if (!user_id) continue;
        const bureau_id = await runtime.text("bureau_id");
        if (!bureau_id) continue;
        const token = await runtime.with_loading(t({ zh: "签发 Token", en: "Issue Token" }), async () => await admin.service("accounts").action("tokens/issue").invoke<{ user_token: string }>({ bureau_id, user_id }));
        await runtime.show_text("User Token", token.user_token);
      }
    } catch (e) {
      rethrowAdminAuthError(e);
      await runtime.show_message("error", adminErrorMessage(e));
    }
  }
}
