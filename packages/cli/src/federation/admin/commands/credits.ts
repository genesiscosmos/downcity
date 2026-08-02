/**
 * Federation Credits 管理命令。
 *
 * 本模块只通过 FederationAdmin Credits typed invoker 管理 Card 与账务记录，不直接理解
 * 支付订单、奖励活动或模型计费策略。
 */

import { FederationAdmin } from "@downcity/city";
import { t } from "@/shared/CliLocale.js";
import { adminErrorMessage, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

/** 打开 Credits 管理循环。 */
export async function manage_credits(a: FederationAdmin, _base_url: string, runtime: admin_tui_runtime): Promise<void> {
  while (true) {
    const action = await runtime.select("Credits", [
      { label: t({ zh: "用户额度", en: "User credits" }), value: "users" },
      { label: t({ zh: "限时 Cards", en: "Ephemeral cards" }), value: "cards" },
      { label: "Transactions", value: "transactions" },
      { label: t({ zh: "Card 流水", en: "Card history" }), value: "history" },
      { label: t({ zh: "增加永久额度", en: "Top up primary card" }), value: "topup" },
      { label: t({ zh: "创建限时 Card", en: "Create ephemeral card" }), value: "create_card" },
      { label: t({ zh: "消费额度", en: "Charge credits" }), value: "charge" },
      { label: t({ zh: "导航", en: "Navigation" }), value: "__section_navigation__", disabled: true },
      { label: t({ zh: "返回", en: "Back" }), value: "back" },
    ]);
    if (!action || action === "back") return;

    try {
      if (action === "users") await show_users(a, runtime);
      if (action === "cards") await show_cards(a, runtime);
      if (action === "transactions") await show_transactions(a, runtime);
      if (action === "history") await show_history(a, runtime);
      if (action === "topup") await topup_primary(a, runtime);
      if (action === "create_card") await create_ephemeral_card(a, runtime);
      if (action === "charge") await charge_credits(a, runtime);
    } catch (error) {
      rethrowAdminAuthError(error);
      await runtime.show_message("error", adminErrorMessage(error));
    }
  }
}

/** 展示用户 Credits 汇总。 */
async function show_users(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const items = await runtime.with_loading("Credits", () => a.credits.list_users({ limit: 30 }));
  await runtime.show_table({
    title: t({ zh: `${items.length} 个 Credits 用户`, en: `${items.length} Credits users` }),
    columns: [t({ zh: "用户", en: "User" }), "Available", "Primary", "Ephemeral", "Cards"],
    rows: items.map((item) => ({
      cells: [item.user_id, String(item.available_credits), String(item.primary_credits), String(item.ephemeral_credits), String(item.active_ephemeral_cards)],
    })),
    empty_message: t({ zh: "暂无 Credits 用户。", en: "No Credits users." }),
  });
}

/** 展示限时 Cards。 */
async function show_cards(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const user_id = await runtime.text(t({ zh: "user_id（可选）", en: "user_id (optional)" }));
  const items = await runtime.with_loading("Ephemeral Cards", () => a.credits.cards.list_ephemeral({
    user_id: user_id || undefined,
    include_history: true,
    limit: 30,
  }));
  await runtime.show_table({
    title: "Ephemeral Cards",
    columns: ["Card ID", t({ zh: "用户", en: "User" }), t({ zh: "名称", en: "Name" }), "Credits", "Status", "Expires"],
    rows: items.map((item) => ({ cells: [item.card_id, item.user_id, item.name, String(item.credits), item.status, item.expires_at] })),
    empty_message: t({ zh: "暂无限时 Card。", en: "No ephemeral cards." }),
  });
}

/** 展示 Transactions。 */
async function show_transactions(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const user_id = await runtime.text(t({ zh: "user_id（可选）", en: "user_id (optional)" }));
  const items = await runtime.with_loading("Transactions", () => a.credits.transactions.list({ user_id: user_id || undefined, limit: 30 }));
  await runtime.show_table({
    title: "Credits Transactions",
    columns: ["Created", "Transaction ID", t({ zh: "用户", en: "User" }), "Kind", "Credits", "Source"],
    rows: items.map((item) => ({ cells: [item.created_at, item.transaction_id, item.user_id, item.kind, String(item.credits), item.source] })),
    empty_message: t({ zh: "暂无 Transaction。", en: "No transactions." }),
  });
}

/** 展示 Card Entries。 */
async function show_history(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const user_id = await runtime.text(t({ zh: "user_id（可选）", en: "user_id (optional)" }));
  const items = await runtime.with_loading("Credits History", () => a.credits.history.list({ user_id: user_id || undefined, limit: 30 }));
  await runtime.show_table({
    title: "Credits History",
    columns: ["Created", "Transaction ID", "Card", "Kind", "Delta", "After"],
    rows: items.map((item) => ({ cells: [item.created_at, item.transaction_id, item.card_id, item.card_kind, String(item.credits_delta), String(item.credits_after)] })),
    empty_message: t({ zh: "暂无流水。", en: "No history." }),
  });
}

/** 给用户 Primary Card 墺加额度。 */
async function topup_primary(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const user_id = await required_text(runtime, "user_id");
  if (!user_id) return;
  const credits = await required_credits(runtime);
  if (!credits) return;
  const source = await required_text(runtime, "source");
  if (!source) return;
  const idempotency_key = await required_text(runtime, "idempotency_key");
  if (!idempotency_key) return;
  const transaction = await a.credits.topup({
    card: { kind: "primary", user_id },
    credits,
    source,
    idempotency_key,
  });
  await runtime.show_message("success", `${transaction.transaction_id}: +${transaction.credits}`);
}

/** 创建限时 Card 并写入初始额度。 */
async function create_ephemeral_card(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const user_id = await required_text(runtime, "user_id");
  const name = await required_text(runtime, "name");
  const initial_credits = await required_credits(runtime);
  const expires_at = await required_text(runtime, "expires_at (ISO)");
  const source = await required_text(runtime, "source");
  const idempotency_key = await required_text(runtime, "idempotency_key");
  if (!user_id || !name || !initial_credits || !expires_at || !source || !idempotency_key) return;
  const card = await a.credits.cards.create_ephemeral({ user_id, name, initial_credits, expires_at, source, idempotency_key });
  await runtime.show_message("success", `${card.card_id}: ${card.credits} credits`);
}

/** 自动选择 Cards 消费用户额度。 */
async function charge_credits(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const user_id = await required_text(runtime, "user_id");
  const credits = await required_credits(runtime);
  const source = await required_text(runtime, "source");
  const idempotency_key = await required_text(runtime, "idempotency_key");
  if (!user_id || !credits || !source || !idempotency_key) return;
  const transaction = await a.credits.charge({ user_id, credits, source, idempotency_key });
  await runtime.show_message("success", `${transaction.transaction_id}: -${transaction.credits}`);
}

/** 读取必填文本，取消输入时返回空。 */
async function required_text(runtime: admin_tui_runtime, label: string): Promise<string> {
  return String(await runtime.text(label) ?? "").trim();
}

/** 读取正整数 Credits。 */
async function required_credits(runtime: admin_tui_runtime): Promise<number | undefined> {
  const raw_credits = await runtime.text("credits");
  if (!raw_credits) return undefined;
  const credits = Number(raw_credits);
  if (!Number.isSafeInteger(credits) || credits <= 0) {
    throw new TypeError("credits must be a positive safe integer");
  }
  return credits;
}
