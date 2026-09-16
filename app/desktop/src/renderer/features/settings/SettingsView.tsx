/** Downcity Desktop 设置与 Federation 用户视图。 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { TbArrowLeft, TbArrowRight, TbBrandGithub, TbBrandGoogle, TbBrandWechat, TbCheck, TbChevronDown, TbChevronRight, TbCode, TbCoin, TbCopy, TbCurrencyDollar, TbInfoCircle, TbLoader2, TbLogin2, TbLogout, TbMail, TbPlugConnected, TbPlus, TbRefresh, TbRotate, TbSwitchHorizontal, TbTicket, TbUser } from "react-icons/tb";
import type { IconType } from "react-icons";
import { LLMModelIcon } from "@/components/model";
import { ModelPricingChart } from "@/components/model/ModelPricingChart";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { UsageHeatmap } from "@/components/usage/UsageHeatmap";
import { UsageLineChart } from "@/components/usage/UsageLineChart";
import { MainViewBody, MainViewHeader } from "@/layouts/MainViewLayout";
import { format_credits_as_usd } from "@/lib/usage/usage_format";
import { build_usage_heatmap, build_usage_trend, current_date_key, sum_heatmap_credits, summarize_usage_period } from "@/lib/usage/usage_metrics";
import { format_compact_number, format_credit_amount, format_token_count, format_usd_price } from "@/lib/model/model_format";
import { build_model_pricing } from "@/lib/model/model_pricing";
import { format_model_reasoning, get_default_model_reasoning } from "@/lib/model/model_reasoning";
import { cn } from "@/lib/utils";
import { translate as translate_text, use_translation } from "@/locales/i18n";
import { SettingGroup, SettingItem, SettingSection, SettingsContainer, SettingsHeader, SettingsMainContent } from "@/components/settings/SettingComponents";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopController, SettingsSection } from "@/types/DesktopView";
import type { UsagePeriod } from "@/types/DesktopUsage";
import type { DesktopAccountResources, DesktopLoginProvider, DesktopModelSummary } from "@common/types/DesktopApi";

/** 设置主视图属性。 */
interface SettingsViewProps {
  /** Renderer 根控制器。 */
  controller: DesktopController;
  /** 当前设置分区。 */
  section: SettingsSection;
  /** 打开 Global Env BayBar 编辑器。 */
  open_global_env(): void;
}

/** Desktop 设置主视图。 */
export function SettingsView({ controller, section, open_global_env }: SettingsViewProps) {
  const translate = use_translation("settings");
  return <>
    <MainViewHeader title={translate("title")} />
    <MainViewBody>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <SettingsMainContent>
            {section === "user" ? <UserSettingsExact controller={controller} /> : null}
            {section === "models" ? <ModelSettingsExact controller={controller} /> : null}
            {section === "general" ? <GeneralSettings controller={controller} open_global_env={open_global_env} /> : null}
            {section === "appearance" ? <AppearanceSettings controller={controller} /> : null}
            {section === "chat" ? <ChatSettings controller={controller} /> : null}
            {section === "shortcuts" ? <ShortcutsSettings /> : null}
          </SettingsMainContent>
        </div>
      </div>
    </MainViewBody>
  </>;
}

/** 按 Duobox AccountSettings 结构展示账户资料、余额、账户切换与用量。 */
function UserSettingsExact({ controller }: { controller: DesktopController }) {
  const translate = use_translation("settings");
  const [accounts_expanded, set_accounts_expanded] = useState(false);
  const [adding_account, set_adding_account] = useState(false);
  const resources = use_desktop_selector(controller.stores.settings, (state) => state.account_resources);
  const account = use_desktop_selector(controller.stores.settings, (state) => state.user);
  const name = account.display_name || account.email || account.user_id || translate("account.none");
  const copy_user_id = async () => { if (account.user_id) await navigator.clipboard?.writeText(account.user_id); };
  return <SettingsContainer>
    {!account.authenticated ? <><section className="flex min-h-56 flex-col items-center justify-center rounded-lg bg-surface-subtle px-6 py-10 text-center"><span className="flex size-11 items-center justify-center rounded-full bg-surface-emphasis text-muted-foreground"><TbUser className="size-5" /></span><h2 className="mt-4 text-sm font-medium text-foreground">{translate("account.no_current")}</h2><p className="mt-1.5 max-w-72 text-xs leading-5 text-muted-foreground">{translate("account.login_description")}</p></section><AccountLoginPanel controller={controller} /></> : <>
      <section className="px-2 py-1" aria-labelledby="account-profile-title"><div className="flex min-w-0 items-center gap-4"><div className="flex size-14 shrink-0 overflow-hidden rounded-full bg-surface-subtle">{account.avatar_url ? <img src={account.avatar_url} alt={name} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-lg font-medium text-muted-foreground">{name.slice(0, 1).toUpperCase()}</div>}</div><div className="min-w-0 flex-1"><div className="group flex min-w-0 items-center gap-1"><h2 id="account-profile-title" className="truncate text-xl font-semibold tracking-tight text-foreground">{name}</h2>{account.user_id ? <Button size="icon" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => void copy_user_id()} title={translate("account.copy_user_id")} aria-label={translate("account.copy_user_id")}><TbCopy /></Button> : null}</div><p className="mt-0.5 truncate text-xs text-muted-foreground">{account.email || account.user_id || account.federation_url}</p></div></div>{account.error ? <p className="mt-3 text-xs text-destructive" role="status">{account.error}</p> : null}</section>
      <SettingSection title={translate("account.credits_title")}><div className="overflow-hidden divide-y divide-divider rounded-lg bg-surface-subtle"><CreditsRow name={translate("account.credits_primary")} amount={resources?.credits ? format_credit_amount(resources.credits.available_credits) : "—"} action={<div className="flex items-center gap-1"><Button disabled={!resources?.credits}><TbTicket />{translate("account.redeem")}</Button><Button variant="primary" disabled={!resources?.credits}><TbCoin />{translate("account.top_up")}</Button></div>} />{resources?.credits?.cards.filter((card) => card.kind === "ephemeral").map((card) => <CreditsRow key={card.card_id} name={card.name} description={card.expires_at ? translate("account.expires", { date: format_date(card.expires_at) }) : undefined} status={card.status === "active" ? undefined : card.status === "depleted" ? translate("account.depleted") : translate("account.expired")} urgent={card.status === "active" && Boolean(card.expires_at && new Date(card.expires_at).getTime() - Date.now() < 7 * 86400000)} amount={format_credit_amount(card.credits)} />)}</div></SettingSection>
      <UsagePanelExact resources={resources} />
      <SettingSection title={translate("account.details")}><SettingGroup><AccountDetailRow label={translate("account.federation_label")} value={account.federation_url} /><AccountDetailRow label={translate("account.user_id")} value={account.user_id || "—"} /><AccountDetailRow label={translate("account.current")} value={account.user_id ? name : "—"} /></SettingGroup></SettingSection>
      <SettingSection><SettingGroup><SettingActionItemExact label={translate("account.switch")} icon={<TbSwitchHorizontal />} trailing={<TbChevronDown className={cn("transition-transform", !accounts_expanded && "-rotate-90")} />} expanded={accounts_expanded} disabled={false} onClick={() => set_accounts_expanded((current) => !current)} />{accounts_expanded ? <div className="p-2"><AccountSwitchListExact controller={controller} on_add={() => set_adding_account(true)} /></div> : null}<SettingActionItemExact label={translate("account.logout")} icon={<TbLogout />} destructive onClick={() => void controller.actions.logout()} /></SettingGroup></SettingSection>
      {adding_account ? <SettingSection title={translate("account.add")}><AccountLoginPanel controller={controller} on_completed={() => set_adding_account(false)} /></SettingSection> : null}
    </>}
  </SettingsContainer>;
}

const default_federation_url = "https://base.downcity.ai";
const provider_icons: Record<string, IconType> = {
  email: TbMail,
  github: TbBrandGithub,
  google: TbBrandGoogle,
  wechat: TbBrandWechat,
};

/** 按 Federation 动态 Provider 执行浏览器授权登录。 */
function AccountLoginPanel({ controller, on_completed }: { controller: DesktopController; on_completed?: () => void }) {
  const translate = use_translation("settings");
  const list_login_providers = controller.actions.list_login_providers;
  const [step, set_step] = useState<"providers" | "federation">("providers");
  const [federation_url, set_federation_url] = useState(default_federation_url);
  const [federation_input, set_federation_input] = useState("");
  const [providers, set_providers] = useState<DesktopLoginProvider[]>([]);
  const [loading, set_loading] = useState(true);
  const [starting_provider_id, set_starting_provider_id] = useState("");
  const [error, set_error] = useState("");

  const load_providers = useCallback(async (target_url: string, force_refresh = false) => {
    set_loading(true);
    set_error("");
    try {
      set_providers(await list_login_providers(target_url, force_refresh));
      return true;
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      set_loading(false);
    }
  }, [list_login_providers]);

  useEffect(() => { void load_providers(default_federation_url); }, [load_providers]);

  const connect_federation = async () => {
    let normalized_url = "";
    try {
      normalized_url = normalize_login_url(federation_input);
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (!await load_providers(normalized_url, true)) return;
    set_federation_url(normalized_url);
    set_step("providers");
  };

  const start_login = async (provider_id: string) => {
    if (starting_provider_id) return;
    set_starting_provider_id(provider_id);
    set_error("");
    try {
      await controller.actions.login(federation_url, provider_id);
      on_completed?.();
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
      set_starting_provider_id("");
    }
  };

  if (step === "federation") {
    return <section className="overflow-hidden rounded-lg bg-surface-subtle">
      <button type="button" className="flex min-h-10 items-center gap-1 px-3.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => { set_error(""); set_step("providers"); }}><TbArrowLeft />{translate("account.back")}</button>
      <label className="block border-y border-divider px-3.5 py-2.5"><span className="block text-xs text-muted-foreground">{translate("account.federation_address")}</span><input autoFocus type="url" className="mt-1 h-8 w-full rounded-md bg-background px-2 text-xs ring-1 ring-border" value={federation_input} placeholder="https://example.com" disabled={loading} onChange={(event) => { set_federation_input(event.target.value); set_error(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void connect_federation(); } }} /></label>
      {error ? <p className="px-3.5 pt-2 text-xs text-destructive" role="alert">{error}</p> : null}
      <div className="flex justify-end px-3.5 py-2.5"><Button variant="primary" disabled={loading || !federation_input.trim()} onClick={() => void connect_federation()}>{loading ? <TbLoader2 className="animate-spin" /> : <TbPlugConnected />}{translate("account.connect")}</Button></div>
    </section>;
  }

  return <section className="overflow-hidden rounded-lg bg-surface-subtle">
    {loading ? <div className="flex h-16 items-center justify-center text-muted-foreground"><TbLoader2 className="size-4 animate-spin" /></div> : providers.length > 0 ? <div className="divide-y divide-divider">{providers.map((provider) => {
      const ProviderIcon = provider_icons[provider.provider_id] || (provider.type === "password" ? TbMail : TbPlugConnected);
      const starting = starting_provider_id === provider.provider_id;
      return <Button key={provider.provider_id} size="full" className="h-10 gap-2 rounded-none px-3 text-xs text-foreground" title={provider.description} disabled={Boolean(starting_provider_id)} onClick={() => void start_login(provider.provider_id)}>{starting ? <TbLoader2 className="size-4 animate-spin" /> : <ProviderIcon className="size-4" />}<span className="min-w-0 flex-1 truncate text-left">{provider.label}</span><TbArrowRight className="text-subtle-foreground" /></Button>;
    })}</div> : <div className="flex min-h-20 flex-col items-center justify-center gap-2 px-4 py-3 text-center"><p className="text-xs text-muted-foreground">{error || translate("account.no_providers")}</p><Button onClick={() => void load_providers(federation_url, true)}><TbRefresh />{translate_text("actions.retry")}</Button></div>}
    {error && providers.length > 0 ? <p className="border-t border-divider px-3.5 py-2 text-xs text-destructive" role="alert">{error}</p> : null}
    <Button size="full" className="h-9 gap-2 rounded-none border-t border-divider px-3 text-xs" disabled={Boolean(starting_provider_id)} onClick={() => { set_federation_input(""); set_error(""); set_step("federation"); }}><TbPlugConnected /><span>{translate("account.other_federation")}</span><TbArrowRight className="ml-auto" /></Button>
  </section>;
}

function normalize_login_url(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(translate_text("settings:account.invalid_protocol"));
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/u, "");
}

function CreditsRow({ name, description, status, urgent, amount, action }: { name: string; description?: string; status?: string; urgent?: boolean; amount: string; action?: ReactNode }) { return <div className="px-3.5 py-3"><div className="flex min-h-8 items-center gap-3"><TbCurrencyDollar className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm text-foreground">{name}</p>{status ? <span className="shrink-0 text-3xs text-destructive">{status}</span> : null}</div>{description ? <p className={cn("mt-0.5 truncate text-2xs", urgent ? "text-destructive" : "text-muted-foreground")}>{description}</p> : null}</div><p className="shrink-0 text-lg font-semibold tracking-tight text-foreground tabular-nums">{amount}</p></div>{action ? <div className="mt-2 flex justify-end">{action}</div> : null}</div>; }
function AccountDetailRow({ label, value }: { label: string; value: ReactNode }) { return <div className="flex min-h-12 items-center gap-4 px-3.5 py-2.5"><span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span><span className="min-w-0 flex-1 truncate text-right text-xs text-foreground">{value}</span></div>; }
function SettingActionItemExact({ label, icon, trailing, destructive, expanded, disabled, onClick }: { label: string; icon: ReactNode; trailing?: ReactNode; destructive?: boolean; expanded?: boolean; disabled?: boolean; onClick(): void }) { return <button type="button" disabled={disabled} aria-expanded={expanded} onClick={onClick} className={cn("flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left text-xs outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover disabled:pointer-events-none disabled:opacity-50", destructive && "text-destructive")}><span className="flex size-5 items-center justify-center">{icon}</span><span className="min-w-0 flex-1">{label}</span>{trailing}</button>; }
function AccountSwitchListExact({ controller, on_add }: { controller: DesktopController; on_add(): void }) { const translate = use_translation("settings"); const accounts = use_desktop_selector(controller.stores.settings, (state) => state.accounts); return <div className="flex min-h-0 flex-col gap-3">{accounts.length > 0 ? <div className="overflow-hidden divide-y divide-divider rounded-lg bg-surface-subtle">{accounts.map((account) => { const label = account.display_name || account.email || account.user_id || account.federation_url; return <button key={account.account_id} type="button" disabled={account.active} className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left text-xs outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover disabled:opacity-100" onClick={() => void controller.actions.switch_account(account.account_id)}><span className="flex size-7 shrink-0 overflow-hidden rounded-full bg-surface-emphasis">{account.avatar_url ? <img src={account.avatar_url} alt={label} className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-3xs font-medium text-muted-foreground">{label.slice(0, 1).toUpperCase()}</span>}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm text-foreground">{label}</span><span className="block truncate text-2xs text-muted-foreground">{account.email || account.user_id || account.federation_url}</span></span>{account.active ? <TbCheck className="size-4 shrink-0 text-foreground" /> : null}</button>; })}</div> : <div className="rounded-lg bg-surface-subtle px-4 py-8 text-center text-xs text-muted-foreground">{translate("account.saved_empty")}</div>}<Button size="sidebar" onClick={on_add}><TbPlus />{translate("account.add")}</Button></div>; }
function UsagePanelExact({ resources }: { resources?: DesktopAccountResources }) {
  const translate = use_translation("settings");
  const [period, set_period] = useState<UsagePeriod>("day");
  const all_days = resources?.usage_days ?? [];
  const end_date = current_date_key();
  const period_summary = useMemo(() => summarize_usage_period(all_days, period, end_date), [all_days, end_date, period]);
  const trend = useMemo(() => build_usage_trend(all_days, period, end_date), [all_days, end_date, period]);
  const heatmap = useMemo(() => build_usage_heatmap(all_days, end_date), [all_days, end_date]);
  const heatmap_credits_used = useMemo(() => sum_heatmap_credits(heatmap), [heatmap]);
  const total_credits = all_days.reduce((sum, day) => sum + day.credits_used, 0);
  const total_tokens = all_days.reduce((sum, day) => sum + day.total_tokens, 0);
  const credits_per_usd = resources?.credits_per_usd;
  const usage_period_options = (["day", "week", "month"] as const).map((value) => ({ value, label: translate(`usage.${value}`) }));
  const period_label = translate(period === "day" ? "usage_panel.today" : period === "week" ? "usage_panel.this_week" : "usage_panel.this_month");
  const period_credits_label = translate(period === "day" ? "usage_panel.today_credits" : period === "week" ? "usage_panel.week_credits" : "usage_panel.month_credits");
  const period_tokens_label = translate(period === "day" ? "usage_panel.today_tokens" : period === "week" ? "usage_panel.week_tokens" : "usage_panel.month_tokens");
  return <SettingSection title={translate("usage_panel.title")} description={period_label} action={<SegmentedControl<UsagePeriod> value={period} options={usage_period_options} aria_label={translate("usage_panel.period")} on_value_change={set_period} />}>
    <div className="overflow-hidden rounded-lg bg-surface-subtle">
      <div className="grid grid-cols-2 divide-x divide-y divide-divider sm:grid-cols-4 sm:divide-y-0"><UsageMetric label={translate("usage_panel.total_credits")} value={format_credits_as_usd(total_credits, credits_per_usd)} /><UsageMetric label={period_credits_label} value={format_credits_as_usd(period_summary.credits_used, credits_per_usd)} /><UsageMetric label={translate("usage_panel.total_tokens")} value={format_compact_number(total_tokens)} /><UsageMetric label={period_tokens_label} value={format_compact_number(period_summary.total_tokens)} /></div>
      <div className="border-t border-divider px-3.5 py-4"><p className="mb-3 text-2xs text-muted-foreground">{translate("usage_panel.activity")}</p><UsageHeatmap heatmap={heatmap} credits_used={heatmap_credits_used} credits_per_usd={credits_per_usd} /></div>
      <div className="border-t border-divider px-3.5 py-4"><p className="mb-2 text-2xs text-muted-foreground">{translate("usage_panel.trend")}</p><UsageLineChart series={trend} period={period} credits_per_usd={credits_per_usd} /></div>
    </div>
  </SettingSection>;
}
function UsageMetric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 px-3.5 py-3.5"><p className="truncate text-3xs text-muted-foreground">{label}</p><p className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p></div>; }

/** 按 Duobox ModelsSettings 结构展示默认模型与可折叠模型列表。 */
function ModelSettingsExact({ controller }: { controller: DesktopController }) {
  const translate = use_translation("settings");
  const models = use_desktop_selector(controller.stores.catalog, (state) => state.models);
  const models_loading = use_desktop_selector(controller.stores.catalog, (state) => state.models_loading);
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  const user = use_desktop_selector(controller.stores.settings, (state) => state.user);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const [selected_model, set_selected_model] = useState<DesktopModelSummary>();
  const [model_dialog_open, set_model_dialog_open] = useState(false);
  const [pricing_expanded, set_pricing_expanded] = useState(false);
  const [image_pricing_expanded, set_image_pricing_expanded] = useState(false);
  const text_models = useMemo(() => models.filter(is_text_model), [models]);
  const image_models = useMemo(() => models.filter(is_image_model), [models]);
  const pricing = useMemo(() => build_model_pricing(text_models), [text_models]);
  const image_pricing = useMemo(() => build_model_pricing(image_models), [image_models]);
  const default_text = text_models.find((model) => model.model_id === settings.default_text_model_id) ?? text_models[0];
  const default_image = image_models.find((model) => model.model_id === settings.default_image_model_id) ?? image_models[0];
  return <SettingsContainer>{!user.authenticated ? <SettingSection title={translate("sections.models")}><SettingGroup><div className="flex items-center justify-between gap-4 rounded-md p-2"><div className="min-w-0"><div className="text-sm text-foreground">{translate("model_catalog.manage_after_login")}</div><div className="mt-0.5 text-xs text-muted-foreground">{translate("model_catalog.login_description")}</div></div><Button onClick={() => controller.actions.open_settings("user")} disabled={loading}><TbLogin2 />{translate("model_catalog.login")}</Button></div></SettingGroup></SettingSection> : <>
    <SettingSection title={translate("model_catalog.text")} action={<Button title={translate("model_catalog.refresh")} aria-label={translate("model_catalog.refresh")} disabled={models_loading} onClick={() => void controller.actions.refresh_models()}>{models_loading ? <TbLoader2 className="animate-spin" /> : <TbRefresh />}{translate_text("actions.refresh")}</Button>}><SettingGroup><CollapsibleModelGroup title={default_text?.name || translate("model_catalog.no_text")} count={text_models.length} model={default_text} models={text_models} active_model_id={settings.default_text_model_id} on_select={(model_id) => void controller.actions.update_settings({ default_text_model_id: model_id })} empty_text={translate("model_catalog.no_text")} on_info={(model) => { set_selected_model(model); set_model_dialog_open(true); }} /><button type="button" className="flex min-h-11 w-full items-center gap-2 border-t border-divider px-3.5 py-2.5 text-left text-xs text-foreground outline-none hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30" aria-expanded={pricing_expanded} onClick={() => set_pricing_expanded((current) => !current)}><TbChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", pricing_expanded && "rotate-90")} /><span className="min-w-0 flex-1">{translate("pricing.comparison")}</span><span className="text-3xs text-muted-foreground">{translate("pricing.unit_value")} · {pricing.length}</span></button>{pricing_expanded ? <div className="border-t border-divider px-3.5 py-4">{pricing.length ? <ModelPricingChart data={pricing} /> : <div className="py-5 text-center text-xs text-muted-foreground">{translate("pricing.empty")}</div>}</div> : null}</SettingGroup></SettingSection>
    <SettingSection title={translate("model_catalog.image")}><SettingGroup><CollapsibleModelGroup title={default_image?.name || translate("model_catalog.no_image")} count={image_models.length} model={default_image} models={image_models} active_model_id={settings.default_image_model_id} on_select={(model_id) => void controller.actions.update_settings({ default_image_model_id: model_id })} empty_text={translate("model_catalog.no_image")} on_info={(model) => { set_selected_model(model); set_model_dialog_open(true); }} /><ModelPricingDisclosure data={image_pricing} expanded={image_pricing_expanded} on_expanded_change={set_image_pricing_expanded} /></SettingGroup></SettingSection>
    <Dialog open={model_dialog_open} onOpenChange={set_model_dialog_open} onOpenChangeComplete={(open) => { if (!open) set_selected_model(undefined); }}><DialogContent><ModelDetailsDialog model={selected_model} /></DialogContent></Dialog>
  </>}</SettingsContainer>;
}
function CollapsibleModelGroup({ title, count, model, models, active_model_id, on_select, empty_text, on_info }: { title: string; count: number; model?: DesktopModelSummary; models: DesktopModelSummary[]; active_model_id: string; on_select(model_id: string): void; empty_text: string; on_info(model: DesktopModelSummary): void }) { const [expanded, set_expanded] = useState(false); return <div className="overflow-hidden"><button type="button" className="flex min-h-12 w-full items-center gap-2 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover" onClick={() => set_expanded((current) => !current)}><TbChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />{model ? <LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-4" /> : null}<span className="min-w-0 flex-1 truncate text-xs text-foreground">{title}</span><span className="text-3xs tabular-nums text-muted-foreground">{count}</span></button>{expanded ? <div className="divide-y divide-divider border-t border-divider">{models.length ? models.map((item) => <ModelRowExact key={item.model_id} model={item} active={item.model_id === active_model_id || (!active_model_id && item.model_id === model?.model_id)} on_select={() => on_select(item.model_id)} on_info={() => on_info(item)} />) : <div className="flex min-h-16 items-center justify-center px-3 py-3 text-center text-xs text-muted-foreground">{empty_text}</div>}</div> : null}</div>; }
function ModelRowExact({ model, active, on_select, on_info }: { model: DesktopModelSummary; active: boolean; on_select(): void; on_info(): void }) { const translate = use_translation("settings"); const reasoning_efforts = format_model_reasoning(model); const reasoning_label = reasoning_efforts ? `${translate("model_catalog.reasoning")}: ${reasoning_efforts}` : ""; return <div className={cn("group flex min-h-10 w-full items-center gap-2 px-3.5 py-1 transition-colors hover:bg-interaction-hover", active && "bg-interaction-selected hover:bg-interaction-active")}><button type="button" onClick={on_select} aria-pressed={active} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"><LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-4" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{model.name}</span>{reasoning_label ? <span className="block truncate text-3xs text-muted-foreground">{reasoning_label}</span> : null}</span></button><div className="flex shrink-0 items-center gap-1">{model.context_window ? <span className="rounded bg-surface-subtle px-1.5 text-3xs leading-4 text-muted-foreground tabular-nums">{format_token_count(model.context_window)}</span> : null}<button type="button" className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30" aria-label={translate("model_catalog.details_for", { name: model.name })} title={translate("model_catalog.details")} onClick={on_info}><TbInfoCircle className="size-3.5" /></button><TbCheck className={cn("size-4 text-foreground transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden="true" /></div></div>; }
function ModelDetailsDialog({ model }: { model?: DesktopModelSummary }) { const translate = use_translation("settings"); const translate_chat = use_translation("chat"); if (!model) return null; const pricing = build_model_pricing([model])[0]; const reasoning_label = format_model_reasoning(model); const default_effort = get_default_model_reasoning(model); return <><DialogHeader><DialogTitle>{model.name}</DialogTitle><DialogDescription>{model.description || model.model_id}</DialogDescription></DialogHeader><DialogBody className="flex flex-col gap-3"><div className="grid grid-cols-2 gap-2 text-xs"><DetailRow label={translate("model_catalog.model_id")} value={model.model_id} /><DetailRow label={translate("model_catalog.context_window")} value={model.context_window ? format_token_count(model.context_window) : translate_chat("model.not_provided")} /><DetailRow label={translate("model_catalog.capabilities")} value={model.modalities.join(" / ") || translate_chat("model.not_provided")} /><DetailRow label={translate("model_catalog.reasoning")} value={reasoning_label || translate("model_catalog.unsupported_reasoning")} />{default_effort ? <DetailRow label={translate_chat("model.default_effort")} value={default_effort.name} /> : null}<DetailRow label={translate("pricing.price_unit")} value={translate("pricing.unit_value")} /></div><div className="rounded-lg bg-muted/45 px-3 py-2.5 text-xs"><div className="mb-2 text-muted-foreground">{translate("pricing.price")}</div>{pricing ? <div className="grid grid-cols-2 gap-2"><DetailRow label={translate("pricing.input")} value={`$${format_usd_price(pricing.input_usd_per_1m)}`} /><DetailRow label={translate("pricing.output")} value={`$${format_usd_price(pricing.output_usd_per_1m)}`} /></div> : <div className="text-muted-foreground">{translate("pricing.unavailable")}</div>}</div></DialogBody></>; }
function ModelPricingDisclosure({ data, expanded, on_expanded_change }: { data: ReturnType<typeof build_model_pricing>; expanded: boolean; on_expanded_change(expanded: boolean): void }) { const translate = use_translation("settings"); return <><button type="button" className="flex min-h-11 w-full items-center gap-2 border-t border-divider px-3.5 py-2.5 text-left text-xs text-foreground outline-none hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30" aria-expanded={expanded} onClick={() => on_expanded_change(!expanded)}><TbChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")} /><span className="min-w-0 flex-1">{translate("pricing.comparison")}</span><span className="text-3xs text-muted-foreground">{translate("pricing.unit_value")} · {data.length}</span></button>{expanded ? <div className="border-t border-divider px-3.5 py-4">{data.length ? <ModelPricingChart data={data} /> : <div className="py-5 text-center text-xs text-muted-foreground">{translate("pricing.empty")}</div>}</div> : null}</>; }
function DetailRow({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><div className="text-3xs text-muted-foreground">{label}</div><div className="mt-0.5 truncate text-foreground" title={value}>{value}</div></div>; }

/** 通用设置。 */
function GeneralSettings({ controller, open_global_env }: { /** Renderer 稳定控制器。 */ controller: DesktopController; /** 打开 Global Env 编辑器。 */ open_global_env(): void }) {
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const translate = use_translation("settings");
  return <SettingsContainer>
    <SettingsHeader title={translate("general.title")} description={translate("general.description")} />
    <SettingSection title={translate("language.title")}>
      <SettingGroup>
        <SettingItem label={translate("language.title")} description={translate("language.description")}>
          <SegmentedControl value={settings.language} aria_label={translate("language.title")} options={[{ value: "en", label: translate("language.english") }, { value: "zh", label: translate("language.chinese") }]} on_value_change={(language) => void controller.actions.update_settings({ language })} />
        </SettingItem>
      </SettingGroup>
    </SettingSection>
    <SettingSection title={translate("general.startup")}>
      <SettingGroup>
        <SettingItem label={translate("general.default_agent")} description={translate("general.default_agent_description")}>
          <SettingSelect value={settings.default_agent_id} label={agents.find((agent) => agent.agent_id === settings.default_agent_id)?.name || translate("general.first_agent")} options={[{ value: "", label: translate("general.first_agent") }, ...agents.map((agent) => ({ value: agent.agent_id, label: agent.name }))]} on_change={(value) => void controller.actions.update_settings({ default_agent_id: value })} />
        </SettingItem>
        <SettingItem label={translate("general.open_empty_chat")} description={translate("general.open_empty_chat_description")}><SettingSwitch checked={settings.open_empty_chat_on_start} label={translate("general.open_empty_chat")} on_change={(checked) => void controller.actions.update_settings({ open_empty_chat_on_start: checked })} /></SettingItem>
      </SettingGroup>
    </SettingSection>
    <SettingSection title={translate("network.title")} description={translate("network.description")}>
      <SettingGroup>
        <SettingItem label={translate("network.enabled")} description={translate("network.enabled_description")}><SettingSwitch checked={settings.proxy_enabled} label={translate("network.enabled")} on_change={(checked) => void controller.actions.update_settings({ proxy_enabled: checked })} /></SettingItem>
        <SettingItem label={translate("network.address")} description={translate("network.address_description")}>
          <input className="h-8 w-56 rounded-md bg-background px-2 text-xs ring-1 ring-border focus:ring-foreground/20" defaultValue={settings.proxy_url} placeholder={translate("network.address_placeholder")} onBlur={(event) => void controller.actions.update_settings({ proxy_url: event.target.value })} />
        </SettingItem>
      </SettingGroup>
    </SettingSection>
    <SettingSection title={translate("general.global_env")} description={translate("general.global_env_description")}>
      <SettingGroup>
        <SettingActionItemExact label={translate("general.open_env")} icon={<TbCode />} trailing={<TbArrowRight className="text-muted-foreground" />} onClick={open_global_env} />
      </SettingGroup>
    </SettingSection>
  </SettingsContainer>;
}

const theme_options = [
  ["duobox", "Duobox"], ["dim", "Dim"], ["forest", "Forest"],
  ["graph", "Graph"], ["haze", "Haze"], ["mono", "Mono"],
  ["ocean", "Ocean"], ["sunset", "Sunset"], ["vercel", "Vercel"],
] as const;

/** Desktop 外观设置。 */
function AppearanceSettings({ controller }: { /** Renderer 稳定控制器。 */ controller: DesktopController }) {
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  const translate = use_translation("settings");
  return <SettingsContainer>
    <SettingsHeader title={translate("appearance.title")} description={translate("appearance.description")} />
    <SettingSection title={translate("appearance.global")}>
      <SettingGroup>
        <SettingItem label={translate("appearance.mode")} description={translate("appearance.mode_description")}>
          <SegmentedControl
            value={settings.appearance_mode}
            aria_label={translate("appearance.mode")}
            options={[{ value: "light", label: translate("appearance.light") }, { value: "dark", label: translate("appearance.dark") }, { value: "system", label: translate("appearance.system") }]}
            on_value_change={(appearance_mode) => void controller.actions.update_settings({ appearance_mode })}
          />
        </SettingItem>
        <SettingItem label={translate("appearance.color_theme")} description={translate("appearance.color_theme_description")}>
          <SettingSelect value={settings.color_theme} label={theme_options.find(([value]) => value === settings.color_theme)?.[1] || "Duobox"} options={theme_options.map(([value, label]) => ({ value, label }))} on_change={(value) => void controller.actions.update_settings({ color_theme: value as typeof settings.color_theme })} />
        </SettingItem>
        <SettingItem label={translate("appearance.ui_scale")} description={translate("appearance.ui_scale_description")}>
          <div className="flex items-center gap-2">
            <Slider value={settings.ui_scale} min={0.85} max={1.2} step={0.05} aria-label={translate("appearance.ui_scale")} on_value_change={(ui_scale) => void controller.actions.update_settings({ ui_scale })} />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(settings.ui_scale * 100)}%</span>
            <Button size="icon" title={translate("appearance.reset_scale")} onClick={() => void controller.actions.update_settings({ ui_scale: 1 })}><TbRotate /></Button>
          </div>
        </SettingItem>
      </SettingGroup>
    </SettingSection>
  </SettingsContainer>;
}

/** Chat 展示设置。 */
function ChatSettings({ controller }: { /** Renderer 稳定控制器。 */ controller: DesktopController }) {
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  const translate = use_translation("settings");
  return <SettingsContainer>
    <SettingsHeader title={translate("chat.title")} description={translate("chat.description")} />
    <SettingSection title={translate("chat.messages")}>
      <SettingGroup>
        <SettingItem label={translate("chat.show_reasoning")} description={translate("chat.show_reasoning_description")}><SettingSwitch checked={settings.show_reasoning} label={translate("chat.show_reasoning")} on_change={(checked) => void controller.actions.update_settings({ show_reasoning: checked })} /></SettingItem>
        <SettingItem label={translate("chat.auto_scroll")} description={translate("chat.auto_scroll_description")}><SettingSwitch checked={settings.auto_scroll} label={translate("chat.auto_scroll")} on_change={(checked) => void controller.actions.update_settings({ auto_scroll: checked })} /></SettingItem>
      </SettingGroup>
    </SettingSection>
    <SettingSection title={translate("chat.input")}>
      <SettingGroup>
        <SettingItem label={translate("chat.spellcheck")} description={translate("chat.spellcheck_description")}><SettingSwitch checked={settings.spellcheck_enabled} label={translate("chat.spellcheck")} on_change={(checked) => void controller.actions.update_settings({ spellcheck_enabled: checked })} /></SettingItem>
      </SettingGroup>
    </SettingSection>
  </SettingsContainer>;
}

/** 汇总 Desktop 实际注册的应用快捷键；标准表单与按钮键盘语义不重复列出。 */
function ShortcutsSettings() {
  const translate = use_translation("settings");
  return <SettingsContainer>
    <SettingsHeader title={translate("shortcuts.title")} description={translate("shortcuts.description")} />
    <SettingSection title={translate("shortcuts.global_navigation")}>
      <SettingGroup>
        <SettingItem label={translate("shortcuts.toggle_sidebar")} description={translate("shortcuts.toggle_sidebar_description")}><ShortcutKeys keys={["⌘ / Ctrl", "B"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.toggle_baybar")} description={translate("shortcuts.toggle_baybar_description")}><ShortcutKeys keys={["⌘ / Ctrl", "L"]} /></SettingItem>
        {/* 「聚焦 Chat 输入框」的键位已从 L/I 收敛为 I：L 让给右侧面板的展开折叠。 */}
        <SettingItem label={translate("shortcuts.focus_chat_input")} description={translate("shortcuts.focus_chat_input_description")}><ShortcutKeys keys={["⌘ / Ctrl", "I"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.open_settings")} description={translate("shortcuts.open_settings_description")}><ShortcutKeys keys={["⌘ / Ctrl", ","]} /></SettingItem>
        <SettingItem label={translate("shortcuts.open_command_palette")} description={translate("shortcuts.open_command_palette_description")}><ShortcutKeys keys={["⌘ / Ctrl", "P"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.new_conversation")} description={translate("shortcuts.new_conversation_description")}><ShortcutKeys keys={["⌘ / Ctrl", "R"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.close_settings")} description={translate("shortcuts.close_settings_description")}><ShortcutKeys keys={["Esc"]} /></SettingItem>
      </SettingGroup>
    </SettingSection>
    <SettingSection title={translate("shortcuts.primary_views")} description={translate("shortcuts.primary_views_description")}>
      <SettingGroup>
        <SettingItem label={translate("shortcuts.open_chat")} description={translate("shortcuts.open_chat_description")}><ShortcutKeys keys={["⌘ / Ctrl", "1"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.open_workspace")} description={translate("shortcuts.open_workspace_description")}><ShortcutKeys keys={["⌘ / Ctrl", "2"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.open_plugins")} description={translate("shortcuts.open_plugins_description")}><ShortcutKeys keys={["⌘ / Ctrl", "3"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.open_plugin_view")} description={translate("shortcuts.open_plugin_view_description")}><ShortcutKeys keys={["⌘ / Ctrl", "4–9"]} /></SettingItem>
      </SettingGroup>
    </SettingSection>
    <SettingSection title={translate("shortcuts.chat_input")}>
      <SettingGroup>
        <SettingItem label={translate("shortcuts.enter")} description={translate("shortcuts.enter_description")}><ShortcutKeys keys={["Enter"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.hard_break")} description={translate("shortcuts.hard_break_description")}><ShortcutKeys keys={["Shift", "Enter"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.submit")} description={translate("shortcuts.submit_description")}><ShortcutKeys keys={["⌘ / Ctrl", "Enter"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.queue_paused")} description={translate("shortcuts.queue_paused_description")}><ShortcutKeys keys={["⌥ / Alt", "⌘ / Ctrl", "Enter"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.steer")} description={translate("shortcuts.steer_description")}><ShortcutKeys keys={["⌘ / Ctrl", "Shift", "Enter"]} /></SettingItem>
      </SettingGroup>
    </SettingSection>
    <SettingSection title={translate("shortcuts.contextual_actions")} description={translate("shortcuts.contextual_actions_description")}>
      <SettingGroup>
        <SettingItem label={translate("shortcuts.generate_draft")} description={translate("shortcuts.generate_draft_description")}><ShortcutKeys keys={["⌘ / Ctrl", "Enter"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.save_queue_edit")} description={translate("shortcuts.save_queue_edit_description")}><ShortcutKeys keys={["⌘ / Ctrl", "Enter"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.cancel_edit")} description={translate("shortcuts.cancel_edit_description")}><ShortcutKeys keys={["Esc"]} /></SettingItem>
        <SettingItem label={translate("shortcuts.navigate_suggestions")} description={translate("shortcuts.navigate_suggestions_description")}><ShortcutAlternatives shortcuts={[["↑"], ["↓"]]} /></SettingItem>
        <SettingItem label={translate("shortcuts.accept_suggestion")} description={translate("shortcuts.accept_suggestion_description")}><ShortcutKeys keys={["Enter"]} /></SettingItem>
      </SettingGroup>
    </SettingSection>
  </SettingsContainer>;
}

/** 以可辨识的键帽组合展示不可编辑快捷键。 */
function ShortcutKeys({ keys }: { keys: string[] }) {
  return <div className="flex items-center gap-1" aria-label={keys.join(" + ")}>{keys.map((key) => <kbd key={key} className="min-w-7 rounded border border-border bg-background px-1.5 py-1 text-center font-mono text-2xs leading-none text-foreground">{key}</kbd>)}</div>;
}

/** 展示多个都可触发同一动作的快捷键。 */
function ShortcutAlternatives({ shortcuts }: { shortcuts: string[][] }) {
  return <div className="flex items-center gap-2">{shortcuts.map((keys, index) => <div key={keys.join("+")} className="flex items-center gap-2">{index > 0 ? <span className="text-2xs text-muted-foreground">/</span> : null}<ShortcutKeys keys={keys} /></div>)}</div>;
}

/** 二元设置开关。 */
function SettingSwitch({ checked, label, on_change }: { /** 当前值。 */ checked: boolean; /** 无障碍标签。 */ label: string; /** 修改值。 */ on_change(checked: boolean): void }) {
  return <Switch checked={checked} aria-label={label} onCheckedChange={on_change} />;
}

function SettingSelect({ value, label, options, on_change }: { value: string; label: string; options: Array<{ value: string; label: string }>; on_change(value: string): void }) { return <Select value={value} options={options} align="end" aria-label={label} className="min-w-40 max-w-56" on_value_change={on_change} />; }
function is_image_model(model: { modalities: string[]; model_id: string }): boolean { return model.modalities.some((modality) => modality.toLowerCase().includes("image")) || model.model_id.toLowerCase().includes("image"); }
function is_text_model(model: { modalities: string[] }): boolean { return model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality.toLowerCase())); }
function format_date(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
