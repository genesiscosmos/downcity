/**
 * Admin Balance 管理命令。
 */

import { Bureau } from "@downcity/city";
import { t } from "@/shared/CliLocale.js";
import { adminErrorMessage, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

export async function manageBalance(a: Bureau, _baseUrl: string, runtime: admin_tui_runtime): Promise<void> {
  while (true) {
    const act = await runtime.select("Balance", [
        {
          label: t({ zh: "查看余额账户", en: "List balance accounts" }),
          value: "users",
          hint: t({
            zh: "查看用户当前余额和更新时间。",
            en: "List user balances and update times.",
          }),
        },
        {
          label: t({ zh: "余额流水", en: "Ledger history" }),
          value: "history",
          hint: t({
            zh: "查看余额变更记录，包括充值、扣减、兑换码和备注。",
            en: "Inspect balance changes including topups, deductions, redeem codes, and notes.",
          }),
        },
        {
          label: t({ zh: "充值单", en: "Topups" }),
          value: "topups",
          hint: t({
            zh: "查看用户充值单及其金额、状态和备注。",
            en: "List user topups with credits, status, and notes.",
          }),
        },
        {
          label: t({ zh: "兑换码", en: "Redeem codes" }),
          value: "redeem_codes",
          hint: t({
            zh: "查看可用、已兑换或已停用的余额兑换码。",
            en: "List active, redeemed, or disabled balance redeem codes.",
          }),
        },
        {
          label: t({ zh: "人工增加余额", en: "Add balance" }),
          value: "add",
          hint: t({
            zh: "为指定 user_id 手动增加余额，并写入余额流水。",
            en: "Manually add balance to a user_id and write a ledger entry.",
          }),
        },
        {
          label: t({ zh: "人工扣减余额", en: "Subtract balance" }),
          value: "sub",
          hint: t({
            zh: "为指定 user_id 手动扣减余额，并写入余额流水。",
            en: "Manually subtract balance from a user_id and write a ledger entry.",
          }),
        },
        {
          label: t({ zh: "完成充值单", en: "Finish topup" }),
          value: "finish",
          hint: t({
            zh: "将待处理充值单标记为完成，并同步更新余额。",
            en: "Mark a pending topup as finished and apply the balance update.",
          }),
        },
        {
          label: t({ zh: "取消充值单", en: "Cancel topup" }),
          value: "cancel",
          hint: t({
            zh: "取消待处理充值单，不增加用户余额。",
            en: "Cancel a pending topup without increasing user balance.",
          }),
        },
        {
          label: t({ zh: "创建兑换码", en: "Create redeem code" }),
          value: "create_redeem_code",
          hint: t({
            zh: "创建一次性余额兑换码，可交给用户自行兑换。",
            en: "Create a one-time balance redeem code for users to redeem.",
          }),
        },
        {
          label: t({ zh: "停用兑换码", en: "Disable redeem code" }),
          value: "disable_redeem_code",
          hint: t({
            zh: "停用尚未兑换的兑换码，防止继续使用。",
            en: "Disable an unredeemed code so it can no longer be used.",
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
      if (act === "users") {
        const items = await runtime.with_loading(t({ zh: "余额账户", en: "Balance Accounts" }), async () => await a.balance.listUsers(30));
        await runtime.show_table({
          title: t({ zh: `${items.length} 个余额账户`, en: `${items.length} Balance Accounts` }),
          columns: [t({ zh: "用户", en: "User" }), "Credits", t({ zh: "更新时间", en: "Updated" })],
          rows: items.map((item) => ({
            cells: [item.user_id, String(item.credits), item.updated_at.slice(0, 19)],
          })),
          empty_message: t({ zh: "暂无余额账户。", en: "No balance accounts." }),
        });
        continue;
      }

      if (act === "history") {
        const user_id = await runtime.text(t({ zh: "user_id（可选）", en: "user_id (optional)" }));
        const items = await runtime.with_loading(t({ zh: "余额历史", en: "Balance History" }), async () => await a.balance.listHistory({
          limit: 30,
          user_id: user_id ?? "",
        }));
        await runtime.show_table({
          title: t({ zh: `${items.length} 条余额历史`, en: `${items.length} Balance History` }),
          columns: [t({ zh: "创建时间", en: "Created" }), t({ zh: "用户", en: "User" }), t({ zh: "类型", en: "Kind" }), "Credits Delta", "Credits After", t({ zh: "备注", en: "Note" })],
          rows: items.map((item) => ({
            cells: [item.created_at.slice(0, 19), item.user_id, item.kind, String(item.credits_delta), String(item.credits_after), item.note],
          })),
          empty_message: t({ zh: "暂无余额历史。", en: "No balance history." }),
        });
        continue;
      }

      if (act === "topups") {
        const user_id = await runtime.text(t({ zh: "user_id（可选）", en: "user_id (optional)" }));
        const items = await runtime.with_loading("Topups", async () => await a.balance.listTopups({
          limit: 30,
          user_id: user_id ?? "",
        }));
        await runtime.show_table({
          title: t({ zh: `${items.length} 个充值单`, en: `${items.length} Topups` }),
          columns: ["Topup ID", t({ zh: "用户", en: "User" }), "Credits", t({ zh: "状态", en: "Status" }), t({ zh: "备注", en: "Note" })],
          rows: items.map((item) => ({
            cells: [item.topup_id, item.user_id, String(item.credits), item.status, item.note],
          })),
          empty_message: t({ zh: "暂无充值单。", en: "No topups." }),
        });
        continue;
      }

      if (act === "redeem_codes") {
        const status = await runtime.text(t({ zh: "status（可选：active/redeemed/disabled）", en: "status (optional: active/redeemed/disabled)" }));
        const user_id = await runtime.text(t({ zh: "redeemed_by_user_id（可选）", en: "redeemed_by_user_id (optional)" }));
        const items = await runtime.with_loading(t({ zh: "兑换码", en: "Redeem Codes" }), async () => await a.balance.redeemCodes.list({
          limit: 30,
          status: normalizeRedeemCodeStatus(status),
          user_id: user_id ?? "",
        }));
        await runtime.show_table({
          title: t({ zh: `${items.length} 个兑换码`, en: `${items.length} Redeem Codes` }),
          columns: ["Redeem Code ID", t({ zh: "Code", en: "Code" }), "Credits", t({ zh: "状态", en: "Status" }), t({ zh: "归属用户", en: "Owner" }), t({ zh: "备注", en: "Note" })],
          rows: items.map((item) => ({
            cells: [
              item.redeem_code_id,
              item.code_mask,
              String(item.credits),
              item.status,
              item.redeemed_by_user_id || "-",
              item.note,
            ],
          })),
          empty_message: t({ zh: "暂无兑换码。", en: "No redeem codes." }),
        });
        continue;
      }

      if (act === "add" || act === "sub") {
        const user_id = await runtime.text("user_id");
        if (!user_id) continue;
        const rawCredits = await runtime.text("credits");
        if (!rawCredits) continue;

        const credits = Number(rawCredits);
        if (!Number.isInteger(credits) || credits <= 0) {
          await runtime.show_message("error", t({ zh: "credits 必须是正整数", en: "credits must be a positive integer" }));
          continue;
        }

        const note = await runtime.text(t({ zh: "备注（可选）", en: "note (optional)" }));
        const account = await runtime.with_loading(t({ zh: "更新余额", en: "Update Balance" }), async () => act === "add"
          ? await a.balance.add({ user_id: user_id, credits, note: note ?? "" })
          : await a.balance.sub({ user_id: user_id, credits, note: note ?? "" }));
        await runtime.show_message("success", t({
          zh: `余额已更新：${account.user_id} -> ${account.credits}`,
          en: `credits updated: ${account.user_id} -> ${account.credits}`,
        }));
        continue;
      }

      if (act === "create_redeem_code") {
        const rawCredits = await runtime.text("credits");
        if (!rawCredits) continue;

        const credits = Number(rawCredits);
        if (!Number.isInteger(credits) || credits <= 0) {
          await runtime.show_message("error", t({ zh: "credits 必须是正整数", en: "credits must be a positive integer" }));
          continue;
        }

        const code = await runtime.text(t({ zh: "自定义 redeem_code（可选）", en: "custom redeem_code (optional)" }));
        const note = await runtime.text(t({ zh: "备注（可选）", en: "note (optional)" }));
        const issued = await runtime.with_loading(t({ zh: "创建兑换码", en: "Create Redeem Code" }), async () => await a.balance.redeemCodes.create({
          credits,
          code: code ?? "",
          note: note ?? "",
        }));
        await runtime.show_text(t({ zh: "兑换码已创建", en: "Redeem Code Created" }), t({
          zh: `redeem_code 已创建：${issued.redeem_code_id}\ncode: ${issued.code}\ncredits: +${issued.credits}`,
          en: `redeem_code created: ${issued.redeem_code_id}\ncode: ${issued.code}\ncredits: +${issued.credits}`,
        }));
        continue;
      }

      if (act === "disable_redeem_code") {
        const redeemCodeId = await runtime.text("redeem_code_id");
        if (!redeemCodeId) continue;
        const note = await runtime.text(t({ zh: "备注（可选）", en: "note (optional)" }));
        const item = await runtime.with_loading(t({ zh: "停用兑换码", en: "Disable Redeem Code" }), async () => await a.balance.redeemCodes.disable({
          redeem_code_id: redeemCodeId,
          note: note ?? "",
        }));
        await runtime.show_message("success", t({
          zh: `redeem_code 已更新：${item.redeem_code_id} -> ${item.status}`,
          en: `redeem_code updated: ${item.redeem_code_id} -> ${item.status}`,
        }));
        continue;
      }

      const topupId = await runtime.text("topup_id");
      if (!topupId) continue;
      const note = await runtime.text(t({ zh: "备注（可选）", en: "note (optional)" }));
      const topup = await runtime.with_loading(t({ zh: "更新充值单", en: "Update Topup" }), async () => act === "finish"
        ? await a.balance.finishTopup({ topup_id: topupId, note: note ?? "" })
        : await a.balance.cancelTopup({ topup_id: topupId, note: note ?? "" }));
      await runtime.show_message("success", t({
        zh: `充值单已更新：${topup.topup_id} -> ${topup.status}`,
        en: `topup updated: ${topup.topup_id} -> ${topup.status}`,
      }));
    } catch (e) {
      rethrowAdminAuthError(e);
      await runtime.show_message("error", adminErrorMessage(e));
    }
  }
}

function normalizeRedeemCodeStatus(value: string | undefined): "active" | "redeemed" | "disabled" | undefined {
  const normalized = String(value ?? "").trim();
  if (!normalized) return undefined;
  if (normalized === "active" || normalized === "redeemed" || normalized === "disabled") {
    return normalized;
  }
  throw new TypeError(t({
    zh: "status 必须是 active、redeemed 或 disabled",
    en: "status must be active, redeemed, or disabled",
  }));
}
