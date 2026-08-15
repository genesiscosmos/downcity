/**
 * Desktop Federation 账户控制器。
 * Desktop 账户库允许同一个 Federation 保存多个用户，并把当前账户同步回 CLI 配置。
 */
import { Embassy, type EmbassyCurrentUser } from "@downcity/federation";
import type { DesktopAccountResources, DesktopAccountSummary, DesktopCreditsSummary, DesktopCreditCardSummary, DesktopUsageDay, DesktopUserSummary } from "../../common/types/DesktopApi.js";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";

const config_key = "downcity.config";
const vault_key = "desktop.user-accounts";
const default_federation_url = "https://base.downcity.ai";
const default_credits_per_usd = 1_000_000;
interface DesktopEmbassySession { federation_url: string; user_token: string }
interface DesktopDowncityConfig { selected_federation_url?: string; sessions?: Record<string, DesktopEmbassySession> }
interface DesktopStoredAccount { account_id: string; federation_url: string; user_token: string; user_id: string; bureau_id: string; display_name?: string; email?: string; avatar_url?: string; last_used_at: number }
interface DesktopAccountVault { active_account_id?: string; accounts: Record<string, DesktopStoredAccount> }

/** 维护 Federation 账户、当前用户资料与用量资源。 */
export class DesktopUserController {
  constructor(private readonly data: DesktopLocalData, private readonly has_active_sessions: () => boolean = () => false) {}
  async current(): Promise<DesktopUserSummary> {
    const account = this.read_active_account();
    if (!account) {
      const identity = this.read_identity();
      if (!identity.user_token) return { authenticated: false, federation_url: identity.federation_url };
      try { return to_user_summary(identity.federation_url, await new Embassy(identity).user.current()); }
      catch (reason) { return { authenticated: true, federation_url: identity.federation_url, error: to_error_message(reason) }; }
    }
    try {
      const summary = to_user_summary(account.federation_url, await this.embassy(account).user.current());
      const resolved_account = { ...account, account_id: summary.user_id ? make_account_id(account.federation_url, summary.user_id) : account.account_id, ...summary_fields(summary) };
      this.save_account(resolved_account, account.account_id === resolved_account.account_id ? undefined : account.account_id);
      return summary;
    } catch (reason) { return { ...to_user_summary_from_account(account), error: to_error_message(reason) }; }
  }
  async login(federation_url: string, user_token: string): Promise<DesktopUserSummary> {
    const normalized_url = normalize_federation_url(federation_url || default_federation_url);
    const normalized_token = read_string(user_token);
    if (!normalized_token) throw new Error("user_token is required");
    const summary = to_user_summary(normalized_url, await new Embassy({ federation_url: normalized_url, user_token: normalized_token }).user.current());
    if (!summary.user_id || !summary.bureau_id) throw new Error("Federation 用户资料缺少 user_id 或 bureau_id");
    const account: DesktopStoredAccount = { account_id: make_account_id(normalized_url, summary.user_id), federation_url: normalized_url, user_token: normalized_token, ...summary_fields(summary), last_used_at: Date.now() };
    this.save_account(account); this.write_active_config(account); return summary;
  }
  list_accounts(): DesktopAccountSummary[] { const vault = this.read_vault(); return Object.values(vault.accounts).sort((a, b) => b.last_used_at - a.last_used_at).map((account) => to_account_summary(account, account.account_id === vault.active_account_id)); }
  async switch_account(account_id: string): Promise<DesktopUserSummary> {
    if (this.has_active_sessions()) throw new Error("当前有执行中的对话，完成或停止后才能切换账户");
    const vault = this.read_vault(); const account = vault.accounts[account_id]; if (!account) throw new Error("账户不存在");
    const next = { ...account, last_used_at: Date.now() }; this.data.secure_settings.set(vault_key, { ...vault, active_account_id: account_id, accounts: { ...vault.accounts, [account_id]: next } }); this.write_active_config(next); return this.current();
  }
  async remove_account(account_id: string): Promise<DesktopUserSummary> {
    if (this.has_active_sessions()) throw new Error("当前有执行中的对话，完成或停止后才能移除账户");
    const vault = this.read_vault(); if (!vault.accounts[account_id]) throw new Error("账户不存在"); const accounts = { ...vault.accounts }; delete accounts[account_id];
    const next = vault.active_account_id === account_id ? Object.values(accounts).sort((a, b) => b.last_used_at - a.last_used_at)[0] : accounts[vault.active_account_id || ""];
    this.data.secure_settings.set(vault_key, { accounts, ...(next ? { active_account_id: next.account_id } : {}) }); if (next) this.write_active_config(next); else this.clear_active_config(); return this.current();
  }
  async logout(): Promise<DesktopUserSummary> { if (read_string(process.env.DOWNCITY_USER_TOKEN)) throw new Error("当前用户 Token 来自 DOWNCITY_USER_TOKEN 环境变量，无法在 Desktop 中退出"); const active = this.read_active_account(); return active ? this.remove_account(active.account_id) : { authenticated: false, federation_url: this.read_identity().federation_url }; }
  async get_resources(): Promise<DesktopAccountResources> {
    const account = this.read_active_account(); if (!account) return { credits_per_usd: default_credits_per_usd, usage_days: [], credits_error: "当前未登录" };
    const now = new Date(); const from_date = new Date(now); from_date.setDate(from_date.getDate() - 364); const to = local_date_key(now); const from = local_date_key(from_date); const embassy = this.embassy(account);
    const [credits_result, usage_result] = await Promise.allSettled([embassy.user.service("credits").get<Record<string, unknown>>("me"), embassy.user.service("usage").get<Record<string, unknown>>("me", { from, to, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })]);
    const result: DesktopAccountResources = { credits_per_usd: default_credits_per_usd, usage_days: [] };
    if (credits_result.status === "fulfilled") result.credits = normalize_credits(credits_result.value); else result.credits_error = to_error_message(credits_result.reason);
    if (usage_result.status === "fulfilled") { result.credits_per_usd = read_number(usage_result.value.credits_per_usd) || default_credits_per_usd; result.usage_days = normalize_usage_days(usage_result.value.days); } else result.usage_error = to_error_message(usage_result.reason);
    return result;
  }
  private embassy(account: DesktopStoredAccount): Embassy { return new Embassy({ federation_url: account.federation_url, user_token: account.user_token }); }
  private read_active_account(): DesktopStoredAccount | undefined { const vault = this.read_vault(); return vault.active_account_id ? vault.accounts[vault.active_account_id] : undefined; }
  private save_account(account: DesktopStoredAccount, remove_account_id?: string): void { const vault = this.read_vault(); const accounts = { ...vault.accounts, [account.account_id]: account }; if (remove_account_id) delete accounts[remove_account_id]; this.data.secure_settings.set(vault_key, { ...vault, active_account_id: account.account_id, accounts }); }
  private read_vault(): DesktopAccountVault {
    const stored = this.data.secure_settings.get<Partial<DesktopAccountVault>>(vault_key); if (stored?.accounts && typeof stored.accounts === "object") return { active_account_id: stored.active_account_id, accounts: stored.accounts as Record<string, DesktopStoredAccount> };
    const config = this.read_config(); const accounts: Record<string, DesktopStoredAccount> = {}; for (const session of Object.values(config.sessions ?? {})) { const account_id = make_account_id(session.federation_url, session.federation_url); accounts[account_id] = { account_id, federation_url: session.federation_url, user_token: session.user_token, user_id: "", bureau_id: "", last_used_at: Date.now() }; } const selected = config.selected_federation_url ? Object.values(accounts).find((account) => account.federation_url === config.selected_federation_url) : undefined; return { accounts, ...(selected ? { active_account_id: selected.account_id } : {}) };
  }
  private read_config(): DesktopDowncityConfig { return this.data.secure_settings.get<DesktopDowncityConfig>(config_key) ?? {}; }
  private write_active_config(account: DesktopStoredAccount): void { const config = this.read_config(); this.data.secure_settings.set(config_key, { ...config, selected_federation_url: account.federation_url, sessions: { ...config.sessions, [account.federation_url]: { federation_url: account.federation_url, user_token: account.user_token } } }); }
  private clear_active_config(): void { const config = this.read_config(); const sessions = { ...config.sessions }; if (config.selected_federation_url) delete sessions[config.selected_federation_url]; this.data.secure_settings.set(config_key, { ...config, sessions, selected_federation_url: default_federation_url }); }
  private read_identity(): { federation_url: string; user_token?: string } { const config = this.read_config(); const federation_url = normalize_federation_url(read_string(process.env.DOWNCITY_FEDERATION_URL) || read_string(config.selected_federation_url) || default_federation_url); const user_token = read_string(process.env.DOWNCITY_USER_TOKEN) || read_string(config.sessions?.[federation_url]?.user_token); return { federation_url, ...(user_token ? { user_token } : {}) }; }
}

function to_user_summary(federation_url: string, current_user: EmbassyCurrentUser): DesktopUserSummary { return { authenticated: true, federation_url, user_id: current_user.user.user_id, bureau_id: current_user.user.bureau_id, ...(current_user.profile?.display_name ? { display_name: current_user.profile.display_name } : {}), ...(current_user.profile?.email ? { email: current_user.profile.email } : {}), ...(current_user.profile?.avatar_url ? { avatar_url: current_user.profile.avatar_url } : {}) }; }
function to_user_summary_from_account(account: DesktopStoredAccount): DesktopUserSummary { return { authenticated: true, federation_url: account.federation_url, user_id: account.user_id || undefined, bureau_id: account.bureau_id || undefined, display_name: account.display_name, email: account.email, avatar_url: account.avatar_url }; }
function summary_fields(summary: DesktopUserSummary): Pick<DesktopStoredAccount, "user_id" | "bureau_id" | "display_name" | "email" | "avatar_url"> { return { user_id: summary.user_id || "", bureau_id: summary.bureau_id || "", ...(summary.display_name ? { display_name: summary.display_name } : {}), ...(summary.email ? { email: summary.email } : {}), ...(summary.avatar_url ? { avatar_url: summary.avatar_url } : {}) }; }
function to_account_summary(account: DesktopStoredAccount, active: boolean): DesktopAccountSummary { return { account_id: account.account_id, federation_url: account.federation_url, user_id: account.user_id, bureau_id: account.bureau_id, display_name: account.display_name, email: account.email, avatar_url: account.avatar_url, last_used_at: account.last_used_at, active }; }
function normalize_credits(value: Record<string, unknown>): DesktopCreditsSummary { const cards = (value.cards || {}) as Record<string, unknown>; const primary = cards.primary as Record<string, unknown> | undefined; const ephemeral = Array.isArray(cards.ephemeral) ? cards.ephemeral : []; const primary_card: DesktopCreditCardSummary[] = primary ? [{ kind: "primary", card_id: read_string(primary.user_id), name: "Primary", credits: read_number(primary.credits), status: read_number(primary.credits) > 0 ? "active" : "depleted" }] : []; return { available_credits: read_number(value.available_credits), cards: [...primary_card, ...ephemeral.map((item) => { const card = item as Record<string, unknown>; return { kind: "ephemeral" as const, card_id: read_string(card.card_id), name: read_string(card.name) || "Ephemeral", credits: read_number(card.credits), expires_at: read_string(card.expires_at) || undefined, status: card.status === "expired" ? "expired" as const : read_number(card.credits) > 0 ? "active" as const : "depleted" as const }; })] }; }
function normalize_usage_days(value: unknown): DesktopUsageDay[] { if (!Array.isArray(value)) return []; return value.map((item) => { const day = item as Record<string, unknown>; const credits = (day.credits || {}) as Record<string, unknown>; const ai = (day.ai || {}) as Record<string, unknown>; return { date: read_string(day.date), credits_used: read_number(credits.used), total_tokens: read_number(ai.total_tokens), execution_count: read_number(ai.execution_count), image_count: read_number(ai.image_count) }; }).filter((day) => day.date); }
function normalize_federation_url(value: string): string { const raw = read_string(value); const has_protocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(raw); const is_local = raw.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/u.test(raw); const url = new URL(has_protocol ? raw : `${is_local ? "http" : "https"}://${raw}`); if (!url.port && (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname))) url.port = "43127"; return url.toString().replace(/\/+$/u, ""); }
function make_account_id(federation_url: string, user_id: string): string { return `${federation_url}::${user_id}`; }
function local_date_key(date: Date): string { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }
function read_string(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function read_number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0; }
function to_error_message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
