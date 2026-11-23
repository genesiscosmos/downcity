/**
 * Downtown 管理器文本格式化函数。
 *
 * 关键点（中文）
 * - 负责 membership、列表、登录、余额、充值等详情渲染。
 * - 纯函数，不依赖 blessed 状态。
 */

import { t } from "@/shared/CliLocale.js";
import { DowntownSessionResolver } from "@/city/shared/DowntownSessionResolver.js";
import { is_disabled_selectable_item } from "@/city/tui/SelectableList.js";
import type { city_manager_state } from "@/city/tui/DowntownManagerState.js";
import type { DowntownMembershipState, DowntownProfile } from "@/city/types/DowntownMembership.js";
import type { CityBalanceAccount, CityRechargeResult } from "@/city/types/CityBalance.js";
import type { tui_list_item } from "@/city/types/Tui.js";

export function is_disabled_item(item: tui_list_item | undefined): boolean {
  return is_disabled_selectable_item(item);
}

export function format_header(state: city_manager_state): string {
  return [
    `{bold}${t({ zh: "管理 Downtown", en: "Manage Downtown" })}{/bold}`,
    state.subtitle,
    state.last_message ? `{green-fg}${state.last_message}{/green-fg}` : "",
  ].filter(Boolean).join("\n");
}

export function format_city_item_label(item: tui_list_item): string {
  if (is_disabled_item(item)) {
    return `── ${item.title} ──`;
  }
  return item.title;
}

export function format_city_detail(item: tui_list_item | undefined): string {
  if (!item) {
    return t({ zh: "未选择项目", en: "No item selected" });
  }
  if (is_disabled_item(item)) {
    return [
      `{bold}${item.title}{/bold}`,
      t({
        zh: "这是侧边栏分区标题，用于区分当前菜单里的操作区域。",
        en: "This is a sidebar section heading used to group actions in the current menu.",
      }),
    ].join("\n");
  }
  return [
    `{bold}${item.title}{/bold}`,
    item.subtitle,
    "",
    item.detail,
  ].filter(Boolean).join("\n");
}

export function format_footer(item: tui_list_item | undefined): string {
  const base = t({
    zh: "Enter 执行动作 · Esc / q 退出 · ↑↓ 切换 · PgUp/PgDn 翻页",
    en: "Enter run action · Esc / q quit · ↑↓ navigate · PgUp/PgDn page list",
  });
  if (!item || is_disabled_item(item)) return base;
  return `${base} · ${item.subtitle}`;
}

export function build_city_subtitle(
  membership: DowntownMembershipState,
  balance: CityBalanceAccount | null,
): string {
  const login_state = membership.has_user_token
    ? t({ zh: "已登录", en: "signed in" })
    : t({ zh: "未登录", en: "not signed in" });
  const balance_text = balance
    ? t({
      zh: ` · 余额 ${balance.credits}`,
      en: ` · credits ${balance.credits}`,
    })
    : "";
  return `${membership.downtown_url} · ${login_state}${balance_text}`;
}
export function format_membership_detail(membership: DowntownMembershipState): string {
  return t({
    zh: [
      "{bold}当前 Downtown{/bold}",
      `URL：${membership.downtown_url}`,
      `source：${membership.source}`,
      `登录态：${membership.has_user_token ? "已登录" : "未登录"}`,
      membership.user_id ? `账号 ID：${membership.user_id}` : "",
      membership.user_label ? `账号：${membership.user_label}` : "",
    ].filter(Boolean).join("\n"),
    en: [
      "{bold}Current Downtown{/bold}",
      `URL: ${membership.downtown_url}`,
      `source: ${membership.source}`,
      `session: ${membership.has_user_token ? "signed in" : "not signed in"}`,
      membership.user_id ? `account ID: ${membership.user_id}` : "",
      membership.user_label ? `account: ${membership.user_label}` : "",
    ].filter(Boolean).join("\n"),
  });
}

export function format_downtown_list_detail(servers: DowntownProfile[]): string {
  return [
    `{bold}${t({ zh: "可用 Downtown", en: "Available Downtowns" })}{/bold}`,
    "",
    ...servers.map((server) => [
      `${server.selected ? "*" : "-"} ${server.name}`,
      `  URL: ${server.downtown_url}`,
      `  source: ${server.source}`,
      `  session: ${server.has_user_session ? "yes" : "no"}`,
      `  admin: ${server.has_admin_session ? "yes" : "no"}`,
    ].join("\n")),
  ].join("\n");
}

export function format_login_detail(membership: DowntownMembershipState): string {
  return t({
    zh: [
      "{bold}登录{/bold}",
      `当前 City：${membership.downtown_url}`,
      "",
      "Enter 后选择可用登录方式。登录成功后，账号和余额会直接显示在这个 TUI 中。",
    ].join("\n"),
    en: [
      "{bold}Sign in{/bold}",
      `Current City: ${membership.downtown_url}`,
      "",
      "Press Enter to choose an available sign-in method. After sign-in, account and balance will appear in this TUI.",
    ].join("\n"),
  });
}

export function format_balance_detail(account: CityBalanceAccount): string {
  return [
    `{bold}Credits{/bold}`,
    account.display || String(account.credits),
    "",
    `user: ${account.user_id}`,
    `credits: ${account.credits}`,
    ...(typeof account.usd === "number" ? [`usd: ${account.usd}`] : []),
    `created: ${account.created_at}`,
    `updated: ${account.updated_at}`,
  ].join("\n");
}

export function format_current_user_detail(user: Awaited<ReturnType<DowntownSessionResolver["resolve_current_user"]>>): string {
  return [
    `{bold}${t({ zh: "当前账号", en: "Current account" })}{/bold}`,
    `URL: ${user.downtown_url}`,
    `user: ${user.user_id || "unknown"}`,
    user.user_label ? `label: ${user.user_label}` : "",
    `source: ${user.source}`,
    `env url: ${user.env_overrides.downtown_url ? "yes" : "no"}`,
    `env token: ${user.env_overrides.user_token ? "yes" : "no"}`,
    user.warnings.length > 0 ? `\n${user.warnings.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export function format_session_detail(session: {
  downtown_url: string;
  user_id?: string;
  user_label?: string;
  updated_at: string;
}): string {
  return [
    `{bold}${t({ zh: "登录成功", en: "Signed in" })}{/bold}`,
    `URL: ${session.downtown_url}`,
    `user: ${session.user_id || "unknown"}`,
    session.user_label ? `label: ${session.user_label}` : "",
    `updated: ${session.updated_at}`,
  ].filter(Boolean).join("\n");
}

export function format_recharge_result(result: CityRechargeResult): string {
  const checkout_url = typeof result.checkout.checkout_url === "string"
    ? result.checkout.checkout_url.trim()
    : "";
  return [
    `{bold}${t({ zh: "充值已创建", en: "Recharge created" })}{/bold}`,
    `credits: ${result.credits}`,
    `topup_amount_minor: ${result.topup_amount_minor}`,
    `status: ${result.checkout.status ?? "pending"}`,
    `method: ${result.method_id}`,
    result.checkout.payment_id ? `payment: ${result.checkout.payment_id}` : "",
    checkout_url ? `checkout: ${checkout_url}` : "",
    `browser: ${result.opened ? "opened" : "not opened"}`,
  ].filter(Boolean).join("\n");
}

export function format_error_detail(title: string, message?: string): string {
  return [
    `{red-fg}{bold}${title}{/bold}{/red-fg}`,
    message || t({ zh: "未知错误", en: "Unknown error" }),
  ].join("\n");
}

export function loading_text(message: string): string {
  return `{yellow-fg}${message}...{/yellow-fg}`;
}

export function format_locale_description(cli_locale: "zh" | "en"): string {
  if (cli_locale === "zh") {
    return t({
      zh: "当前默认语言：中文",
      en: "Current default language: Chinese",
    });
  }

  return t({
    zh: "当前默认语言：英文",
    en: "Current default language: English",
  });
}
