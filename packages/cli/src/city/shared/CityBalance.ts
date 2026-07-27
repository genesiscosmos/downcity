/**
 * City user 余额与充值流程。
 *
 * 关键点（中文）
 * - 只面向当前 City 已登录的 City user，不提供 admin 加款入口。
 * - 余额读取来自 CreditsService；充值订单由 PaymentService 直接创建。
 * - 交互菜单只调用这里的高层函数，避免 FederationConnection 模块继续膨胀。
 */

import { emitCliBlock } from "@/shared/CliReporter.js";
import { open_system_browser } from "@/shared/SystemBrowser.js";
import { CityUserManager } from "@/city/shared/CityUserManager.js";
import type {
  CityBalanceAccount,
  CityCheckoutResult,
  CityRechargeInput,
  CityRechargeResult,
} from "@/city/types/CityBalance.js";

const DEFAULT_PAYMENT_METHOD_ID = "stripe";
const cityUserManager = new CityUserManager();

/**
 * 读取当前 City user 的余额。
 */
export async function readCurrentCityBalance(): Promise<CityBalanceAccount> {
  const { user, city } = await cityUserManager.createUserClient();
  const summary = await city.service("credits").get<{
    user_id: string;
    available_credits: number;
  }>("me");
  const account: CityBalanceAccount = {
    user_id: summary.user_id,
    credits: summary.available_credits,
    display: `${summary.available_credits} Credits`,
    created_at: "",
    updated_at: new Date().toISOString(),
  };
  assertBalanceUserMatchesToken(account, user.user_id);
  return account;
}

/**
 * 给当前 City user 发起充值。
 */
export async function rechargeCurrentCityUser(
  input: CityRechargeInput,
): Promise<CityRechargeResult> {
  const { city } = await cityUserManager.createUserClient();
  const topup_amount_minor = normalizePositiveInteger(input.topup_amount_minor, "topup_amount_minor");
  const method_id = normalizeText(input.method_id) || DEFAULT_PAYMENT_METHOD_ID;
  const checkout = await city.payment.method(method_id).invoke<CityCheckoutResult>({
    topup_amount_minor,
    idempotency_key: normalizeText(input.ref) || `city_cli:${crypto.randomUUID()}`,
    note: normalizeText(input.note) || "City user recharge",
    metadata: {
      source: "city-cli",
      method_id,
    },
  });
  const checkout_url = normalizeText(checkout.checkout_url);
  const should_open = input.open_checkout !== false;
  const opened = should_open && checkout_url ? open_system_browser(checkout_url) : false;

  return {
    credits: normalizePositiveInteger(checkout.credits, "checkout.credits"),
    topup_amount_minor,
    checkout,
    method_id,
    opened,
  };
}

function assertBalanceUserMatchesToken(
  account: CityBalanceAccount,
  token_user_id: string | undefined,
): void {
  if (!token_user_id) {
    throw new Error("City user token resolved without a user_id. Run `city city login` again.");
  }
  if (account.user_id !== token_user_id) {
    throw new Error([
      "Credits user does not match the authenticated token.",
      `credits=${account.user_id}`,
      `token=${token_user_id}`,
      "Run `city city logout` and then `city city login`.",
    ].join(" "));
  }
}

/**
 * 输出当前 user 余额。
 */
export async function emitCurrentCityBalance(): Promise<void> {
  const account = await readCurrentCityBalance();

  emitCliBlock({
    tone: "success",
    title: "User Credits",
    summary: account.display || String(account.credits),
    facts: [
      { label: "user", value: account.user_id },
      { label: "credits", value: String(account.credits) },
      ...(typeof account.usd === "number" ? [{ label: "usd", value: String(account.usd) }] : []),
      { label: "updated", value: account.updated_at },
    ],
  });
}

/**
 * 输出当前 user 充值结果。
 */
export function emitCityRechargeResult(result: CityRechargeResult): void {
  const checkout_url = normalizeText(result.checkout.checkout_url);
  emitCliBlock({
    tone: checkout_url ? "success" : "warning",
    title: "User recharge",
    summary: String(result.checkout.status ?? "pending"),
    facts: [
      { label: "credits", value: String(result.credits) },
      { label: "topup_amount_minor", value: String(result.topup_amount_minor) },
      { label: "method", value: result.method_id },
      ...(result.checkout.payment_id
        ? [{ label: "payment", value: String(result.checkout.payment_id) }]
        : []),
      ...(checkout_url ? [{ label: "checkout", value: checkout_url }] : []),
      { label: "browser", value: result.opened ? "opened" : "not opened" },
    ],
    note: checkout_url
      ? "Complete the checkout page to finish the recharge."
      : "Checkout URL was not returned by the payment service.",
  });
}

function normalizePositiveInteger(value: unknown, label: string): number {
  const credits = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return credits;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
