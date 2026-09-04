/**
 * Admin Payment 管理命令。
 */

import { EmbassyAdmin } from "@downcity/federation";
import { buildStripeEndpoints } from "@/federation/core/stripe.js";
import { t } from "@/shared/CliLocale.js";
import { adminErrorMessage, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

interface StripePaymentListItem {
  /** 支付记录 ID */
  payment_id: string;
  /** 用户 ID */
  user_id: string;
  /** 充值额度，单位为 credits。 */
  credits: number;
  /** 结算币种 */
  currency: string;
  /** 当前状态 */
  status: string;
  /** 更新时间 */
  updated_at: string;
}

interface StripeEventListItem {
  /** 事件 ID */
  event_id: string;
  /** 事件类型 */
  type: string;
  /** 同步状态 */
  sync_status: string;
  /** 同步错误 */
  sync_error: string;
  /** 创建时间 */
  created_at: string;
}

export async function managePayment(a: EmbassyAdmin, baseUrl: string, runtime: admin_tui_runtime): Promise<void> {
  const svc = a.service("payment");
  const endpoints = buildStripeEndpoints(baseUrl);
  while (true) {
    const act = await runtime.select(t({ zh: "支付方式", en: "Payment methods" }), [
        {
          label: t({ zh: "Stripe webhook 配置", en: "Stripe webhook setup" }),
          value: "webhook",
          hint: t({
            zh: `查看 Stripe endpoint、推荐事件和 signing secret 配置位置：${endpoints.webhook_url}`,
            en: `Inspect Stripe endpoint, recommended events, and signing secret setup: ${endpoints.webhook_url}`,
          }),
        },
        {
          label: t({ zh: "Stripe 支付记录", en: "Stripe payments" }),
          value: "payments",
          hint: t({
            zh: "查看当前 City 通过 Stripe 创建或同步的支付记录，包括用户、金额、币种和状态。",
            en: "List Stripe payment records synced by this City, including user, credits, currency, and status.",
          }),
        },
        {
          label: t({ zh: "Stripe webhook 事件", en: "Stripe webhook events" }),
          value: "events",
          hint: t({
            zh: "查看 Stripe webhook 事件同步状态和错误，用于排查支付回调是否生效。",
            en: "Inspect Stripe webhook sync status and errors to debug payment callbacks.",
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
      if (act === "webhook") {
        await runtime.show_text(t({ zh: "Stripe webhook 配置", en: "Stripe webhook setup" }), [
          `${t({ zh: "Server URL", en: "Server URL" })}: ${endpoints.base_url}`,
          `${t({ zh: "Stripe webhook endpoint", en: "Stripe webhook endpoint" })}: ${endpoints.webhook_url}`,
          t({ zh: "推荐 Stripe events：", en: "Recommended Stripe events:" }),
          "- checkout.session.completed",
          "- checkout.session.expired",
          "- payment_intent.payment_failed",
          t({
            zh: "在 Stripe Dashboard 创建 endpoint 后，将 Signing secret 复制到 STRIPE_WEBHOOK_SECRET。",
            en: "After creating the endpoint in Stripe Dashboard, copy its Signing secret into STRIPE_WEBHOOK_SECRET.",
          }),
        ].join("\n"));
        continue;
      }

      if (act === "payments") {
        const result = await runtime.with_loading(t({ zh: "支付记录", en: "Payments" }), async () => await svc.get<{ items: StripePaymentListItem[] }>("payments"));
        await runtime.show_table({
          title: t({ zh: `${result.items.length} 条支付记录`, en: `${result.items.length} Payments` }),
          columns: [t({ zh: "更新时间", en: "Updated" }), t({ zh: "用户", en: "User" }), "Credits", t({ zh: "币种", en: "Currency" }), t({ zh: "状态", en: "Status" }), "Payment ID"],
          rows: result.items.map((item) => ({
            cells: [item.updated_at.slice(0, 19), item.user_id, String(item.credits), item.currency, item.status, item.payment_id],
          })),
          empty_message: t({ zh: "暂无支付记录。", en: "No payments." }),
        });
        continue;
      }

      const result = await runtime.with_loading(t({ zh: "Webhook 事件", en: "Webhook Events" }), async () => await svc.get<{ items: StripeEventListItem[] }>("events"));
      await runtime.show_table({
        title: t({ zh: `${result.items.length} 条 Webhook 事件`, en: `${result.items.length} Webhook Events` }),
        columns: [t({ zh: "创建时间", en: "Created" }), t({ zh: "类型", en: "Type" }), t({ zh: "状态", en: "Status" }), "Event ID", t({ zh: "错误", en: "Error" })],
        rows: result.items.map((item) => ({
          cells: [item.created_at.slice(0, 19), item.type, item.sync_status, item.event_id, item.sync_error || ""],
        })),
        empty_message: t({ zh: "暂无 webhook 事件。", en: "No webhook events." }),
      });
    } catch (e) {
      rethrowAdminAuthError(e);
      await runtime.show_message("error", adminErrorMessage(e));
    }
  }
}
