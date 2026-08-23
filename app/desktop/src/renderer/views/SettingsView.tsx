/** Downcity Desktop 设置与 Federation 用户视图。 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { TbArrowLeft, TbArrowRight, TbBrandGithub, TbBrandGoogle, TbBrandWechat, TbCheck, TbChevronDown, TbChevronRight, TbCoin, TbCopy, TbCpu, TbCurrencyDollar, TbExternalLink, TbInfoCircle, TbLoader2, TbLogin2, TbLogout, TbMail, TbPlugConnected, TbPlus, TbRefresh, TbRotate, TbSwitchHorizontal, TbTicket, TbUser } from "react-icons/tb";
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
import { MainViewBody, MainViewLayout } from "@/layouts/MainViewLayout";
import { format_credits_as_usd } from "@/lib/usage/usage_format";
import { build_usage_heatmap, build_usage_trend, current_date_key, sum_heatmap_credits, summarize_usage_period } from "@/lib/usage/usage_metrics";
import { build_model_pricing } from "@/lib/model/model_pricing";
import { format_model_reasoning, get_default_model_reasoning } from "@/lib/model/model_reasoning";
import { cn } from "@/lib/utils";
import type { DesktopViewController, SettingsSection } from "@/types/DesktopView";
import type { UsagePeriod } from "@/types/DesktopUsage";

/** 设置主视图属性。 */
interface SettingsViewProps {
  /** Renderer 根控制器。 */
  controller: DesktopViewController;
  /** 当前设置分区。 */
  section: SettingsSection;
}

/** Desktop 设置主视图。 */
export function SettingsView({ controller, section }: SettingsViewProps) {
  return <MainViewLayout>
    <header className="header-drag-region flex h-10 w-full flex-none items-center px-3"><span className="text-xs font-medium text-foreground/80">设置</span></header>
    <MainViewBody>
      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-8 pb-12 pt-10">
            {section === "user" ? <UserSettingsExact controller={controller} /> : null}
            {section === "models" ? <ModelSettingsExact controller={controller} /> : null}
            {section === "general" ? <GeneralSettings controller={controller} /> : null}
            {section === "appearance" ? <AppearanceSettings controller={controller} /> : null}
            {section === "chat" ? <ChatSettings controller={controller} /> : null}
          </div>
        </div>
      </div>
    </MainViewBody>
  </MainViewLayout>;
}

/** 按 Duobox AccountSettings 结构展示账户资料、余额、账户切换与用量。 */
function UserSettingsExact({ controller }: { controller: DesktopViewController }) {
  const [accounts_expanded, set_accounts_expanded] = useState(false);
  const [adding_account, set_adding_account] = useState(false);
  const resources = controller.account_resources;
  const account = controller.user;
  const name = account.display_name || account.email || account.user_id || "暂无账户";
  const copy_user_id = async () => { if (account.user_id) await navigator.clipboard?.writeText(account.user_id); };
  return <SettingsContainer>
    {!account.authenticated ? <><section className="flex min-h-56 flex-col items-center justify-center rounded-lg bg-surface-subtle px-6 py-10 text-center"><span className="flex size-11 items-center justify-center rounded-full bg-foreground/[0.05] text-muted-foreground"><TbUser className="size-5" /></span><h2 className="mt-4 text-sm font-medium text-foreground/90">暂无当前账户</h2><p className="mt-1.5 max-w-72 text-xs leading-5 text-muted-foreground">登录 Federation 后可使用模型、Credits 和个人用量。</p></section><AccountLoginPanel controller={controller} /></> : <>
      <section className="px-2 py-1" aria-labelledby="account-profile-title"><div className="flex min-w-0 items-center gap-4"><div className="flex size-14 shrink-0 overflow-hidden rounded-full bg-surface-subtle">{account.avatar_url ? <img src={account.avatar_url} alt={name} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-lg font-medium text-muted-foreground">{name.slice(0, 1).toUpperCase()}</div>}</div><div className="min-w-0 flex-1"><div className="group flex min-w-0 items-center gap-1"><h2 id="account-profile-title" className="truncate text-xl font-semibold tracking-tight text-foreground">{name}</h2>{account.user_id ? <Button size="icon" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => void copy_user_id()} title="复制用户 ID" aria-label="复制用户 ID"><TbCopy /></Button> : null}</div><p className="mt-0.5 truncate text-xs text-muted-foreground">{account.email || account.user_id || account.federation_url}</p></div></div>{account.error ? <p className="mt-3 text-xs text-destructive" role="status">{account.error}</p> : null}</section>
      <SettingSection title="Credits"><div className="overflow-hidden divide-y divide-divider rounded-lg bg-surface-subtle"><CreditsRow name="Primary Credits" amount={resources?.credits ? format_credits(resources.credits.available_credits) : "—"} action={<div className="flex items-center gap-1"><Button disabled={!resources?.credits}><TbTicket />兑换</Button><Button variant="primary" disabled={!resources?.credits}><TbCoin />充值</Button></div>} />{resources?.credits?.cards.filter((card) => card.kind === "ephemeral").map((card) => <CreditsRow key={card.card_id} name={card.name} description={card.expires_at ? `有效期至 ${format_date(card.expires_at)}` : undefined} status={card.status === "active" ? undefined : card.status === "depleted" ? "已用尽" : "已过期"} urgent={card.status === "active" && Boolean(card.expires_at && new Date(card.expires_at).getTime() - Date.now() < 7 * 86400000)} amount={format_credits(card.credits)} />)}</div></SettingSection>
      <UsagePanelExact resources={resources} />
      <SettingSection title="账户详情"><SettingGroup><AccountDetailRow label="Federation" value={account.federation_url} /><AccountDetailRow label="用户 ID" value={account.user_id || "—"} /><AccountDetailRow label="最近使用" value={account.user_id ? "当前账户" : "—"} /></SettingGroup></SettingSection>
      <SettingSection><SettingGroup><SettingActionItemExact label="切换账户" icon={<TbSwitchHorizontal />} trailing={<TbChevronDown className={cn("transition-transform", !accounts_expanded && "-rotate-90")} />} expanded={accounts_expanded} disabled={false} onClick={() => set_accounts_expanded((current) => !current)} />{accounts_expanded ? <div className="p-2"><AccountSwitchListExact controller={controller} on_add={() => set_adding_account(true)} /></div> : null}<SettingActionItemExact label="退出账户" icon={<TbLogout />} destructive onClick={() => void controller.logout()} /></SettingGroup></SettingSection>
      {adding_account ? <SettingSection title="添加账户"><AccountLoginPanel controller={controller} on_completed={() => set_adding_account(false)} /></SettingSection> : null}
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
function AccountLoginPanel({ controller, on_completed }: { controller: DesktopViewController; on_completed?: () => void }) {
  const list_login_providers = controller.list_login_providers;
  const [step, set_step] = useState<"providers" | "federation">("providers");
  const [federation_url, set_federation_url] = useState(default_federation_url);
  const [federation_input, set_federation_input] = useState("");
  const [providers, set_providers] = useState<Awaited<ReturnType<DesktopViewController["list_login_providers"]>>>([]);
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
      await controller.login(federation_url, provider_id);
      on_completed?.();
    } catch (reason) {
      set_error(reason instanceof Error ? reason.message : String(reason));
      set_starting_provider_id("");
    }
  };

  if (step === "federation") {
    return <section className="overflow-hidden rounded-lg bg-surface-subtle">
      <button type="button" className="flex min-h-10 items-center gap-1 px-3.5 text-xs text-muted-foreground transition-colors hover:text-foreground" onClick={() => { set_error(""); set_step("providers"); }}><TbArrowLeft />返回</button>
      <label className="block border-y border-border/45 px-3.5 py-2.5"><span className="block text-xs text-muted-foreground">Federation 地址</span><input autoFocus type="url" className="mt-1 h-8 w-full rounded-md bg-background px-2 text-xs ring-1 ring-border" value={federation_input} placeholder="https://example.com" disabled={loading} onChange={(event) => { set_federation_input(event.target.value); set_error(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void connect_federation(); } }} /></label>
      {error ? <p className="px-3.5 pt-2 text-xs text-destructive" role="alert">{error}</p> : null}
      <div className="flex justify-end px-3.5 py-2.5"><Button variant="primary" disabled={loading || !federation_input.trim()} onClick={() => void connect_federation()}>{loading ? <TbLoader2 className="animate-spin" /> : <TbPlugConnected />}连接 Federation</Button></div>
    </section>;
  }

  return <section className="overflow-hidden rounded-lg bg-surface-subtle">
    {loading ? <div className="flex h-16 items-center justify-center text-muted-foreground"><TbLoader2 className="size-4 animate-spin" /></div> : providers.length > 0 ? <div className="divide-y divide-divider">{providers.map((provider) => {
      const ProviderIcon = provider_icons[provider.provider_id] || (provider.type === "password" ? TbMail : TbPlugConnected);
      const starting = starting_provider_id === provider.provider_id;
      return <Button key={provider.provider_id} size="full" className="h-10 gap-2 rounded-none px-3 text-xs text-foreground" title={provider.description} disabled={Boolean(starting_provider_id)} onClick={() => void start_login(provider.provider_id)}>{starting ? <TbLoader2 className="size-4 animate-spin" /> : <ProviderIcon className="size-4" />}<span className="min-w-0 flex-1 truncate text-left">{provider.label}</span><TbArrowRight className="text-muted-foreground/60" /></Button>;
    })}</div> : <div className="flex min-h-20 flex-col items-center justify-center gap-2 px-4 py-3 text-center"><p className="text-xs text-muted-foreground">{error || "当前 Federation 没有可用的登录方式"}</p><Button onClick={() => void load_providers(federation_url, true)}><TbRefresh />重试</Button></div>}
    {error && providers.length > 0 ? <p className="border-t border-border/45 px-3.5 py-2 text-xs text-destructive" role="alert">{error}</p> : null}
    <Button size="full" className="h-9 gap-2 rounded-none border-t border-border/45 px-3 text-xs" disabled={Boolean(starting_provider_id)} onClick={() => { set_federation_input(""); set_error(""); set_step("federation"); }}><TbPlugConnected /><span>使用其他 Federation</span><TbArrowRight className="ml-auto" /></Button>
  </section>;
}

function normalize_login_url(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Federation 地址必须使用 HTTP 或 HTTPS");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/u, "");
}

function CreditsRow({ name, description, status, urgent, amount, action }: { name: string; description?: string; status?: string; urgent?: boolean; amount: string; action?: ReactNode }) { return <div className="px-3.5 py-3"><div className="flex min-h-8 items-center gap-3"><TbCurrencyDollar className="size-4 shrink-0 text-muted-foreground/65" /><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><p className="truncate text-[13px] text-foreground/90">{name}</p>{status ? <span className="shrink-0 text-[10px] text-destructive">{status}</span> : null}</div>{description ? <p className={cn("mt-0.5 truncate text-[11px]", urgent ? "text-destructive" : "text-muted-foreground/65")}>{description}</p> : null}</div><p className="shrink-0 text-lg font-semibold tracking-tight text-foreground tabular-nums">{amount}</p></div>{action ? <div className="mt-2 flex justify-end">{action}</div> : null}</div>; }
function AccountDetailRow({ label, value }: { label: string; value: ReactNode }) { return <div className="flex min-h-12 items-center gap-4 px-3.5 py-2.5"><span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span><span className="min-w-0 flex-1 truncate text-right text-xs text-foreground/85">{value}</span></div>; }
function SettingActionItemExact({ label, icon, trailing, destructive, expanded, disabled, onClick }: { label: string; icon: ReactNode; trailing?: ReactNode; destructive?: boolean; expanded?: boolean; disabled?: boolean; onClick(): void }) { return <button type="button" disabled={disabled} aria-expanded={expanded} onClick={onClick} className={cn("flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left text-xs outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover disabled:pointer-events-none disabled:opacity-50", destructive && "text-destructive")}><span className="flex size-5 items-center justify-center">{icon}</span><span className="min-w-0 flex-1">{label}</span>{trailing}</button>; }
function AccountSwitchListExact({ controller, on_add }: { controller: DesktopViewController; on_add(): void }) { return <div className="flex min-h-0 flex-col gap-3">{controller.accounts.length > 0 ? <div className="overflow-hidden divide-y divide-divider rounded-lg bg-surface-subtle">{controller.accounts.map((account) => { const label = account.display_name || account.email || account.user_id || account.federation_url; return <button key={account.account_id} type="button" disabled={account.active} className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left text-xs outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover disabled:opacity-100" onClick={() => void controller.switch_account(account.account_id)}><span className="flex size-7 shrink-0 overflow-hidden rounded-full bg-surface-subtle">{account.avatar_url ? <img src={account.avatar_url} alt={label} className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-[9px] font-medium text-muted-foreground">{label.slice(0, 1).toUpperCase()}</span>}</span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-foreground/90">{label}</span><span className="block truncate text-[11px] text-muted-foreground/70">{account.email || account.user_id || account.federation_url}</span></span>{account.active ? <TbCheck className="size-4 shrink-0 text-foreground/70" /> : null}</button>; })}</div> : <div className="rounded-lg bg-surface-subtle px-4 py-8 text-center text-xs text-muted-foreground">暂无已保存账户</div>}<Button size="sidebar" onClick={on_add}><TbPlus />添加账户</Button></div>; }
const usage_period_options = [{ value: "day", label: "日" }, { value: "week", label: "周" }, { value: "month", label: "月" }] as const;
function UsagePanelExact({ resources }: { resources?: DesktopViewController["account_resources"] }) {
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
  const period_label = period === "day" ? "今天" : period === "week" ? "本周" : "本月";
  const period_credits_label = period === "day" ? "今日 Credits" : period === "week" ? "本周 Credits" : "本月 Credits";
  const period_tokens_label = period === "day" ? "今日 Tokens" : period === "week" ? "本周 Tokens" : "本月 Tokens";
  return <SettingSection title="个人用量" description={period_label} action={<SegmentedControl<UsagePeriod> value={period} options={usage_period_options} aria_label="用量周期" on_value_change={set_period} />}>
    <div className="overflow-hidden rounded-lg bg-surface-subtle">
      <div className="grid grid-cols-2 divide-x divide-y divide-divider sm:grid-cols-4 sm:divide-y-0"><UsageMetric label="总 Credits" value={format_credits_as_usd(total_credits, credits_per_usd)} /><UsageMetric label={period_credits_label} value={format_credits_as_usd(period_summary.credits_used, credits_per_usd)} /><UsageMetric label="总 Tokens" value={format_compact(total_tokens)} /><UsageMetric label={period_tokens_label} value={format_compact(period_summary.total_tokens)} /></div>
      <div className="border-t border-divider px-3.5 py-4"><p className="mb-3 text-[11px] text-muted-foreground">活动</p><UsageHeatmap heatmap={heatmap} credits_used={heatmap_credits_used} credits_per_usd={credits_per_usd} /></div>
      <div className="border-t border-divider px-3.5 py-4"><p className="mb-2 text-[11px] text-muted-foreground">趋势</p><UsageLineChart series={trend} period={period} credits_per_usd={credits_per_usd} /></div>
    </div>
  </SettingSection>;
}
function UsageMetric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 px-3.5 py-3.5"><p className="truncate text-[10px] text-muted-foreground/70">{label}</p><p className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p></div>; }

/** 按 Duobox ModelsSettings 结构展示默认模型与可折叠模型列表。 */
function ModelSettingsExact({ controller }: { controller: DesktopViewController }) {
  const [selected_model, set_selected_model] = useState<DesktopViewController["models"][number]>();
  const [pricing_expanded, set_pricing_expanded] = useState(false);
  const [image_pricing_expanded, set_image_pricing_expanded] = useState(false);
  const text_models = controller.models.filter(is_text_model);
  const image_models = controller.models.filter(is_image_model);
  const pricing = useMemo(() => build_model_pricing(text_models), [text_models]);
  const image_pricing = useMemo(() => build_model_pricing(image_models), [image_models]);
  const default_text = text_models.find((model) => model.model_id === controller.settings.default_text_model_id) ?? text_models[0];
  const default_image = image_models.find((model) => model.model_id === controller.settings.default_image_model_id) ?? image_models[0];
  return <SettingsContainer>{!controller.user.authenticated ? <SettingSection title="模型"><SettingGroup><div className="flex items-center justify-between gap-4 rounded-md p-2"><div className="min-w-0"><div className="text-sm text-foreground/90">登录后管理模型</div><div className="mt-0.5 text-xs text-muted-foreground">登录 Federation 后才能读取文本和生图模型。</div></div><Button onClick={() => controller.open_settings("user")} disabled={controller.loading}><TbLogin2 />登录</Button></div></SettingGroup></SettingSection> : <>
    <SettingSection title="文本模型" action={<Button title="刷新模型" aria-label="刷新模型" disabled={controller.models_loading} onClick={() => void controller.refresh_models()}>{controller.models_loading ? <TbLoader2 className="animate-spin" /> : <TbRefresh />}刷新</Button>}><SettingGroup><CollapsibleModelGroup title={default_text?.name || "暂无文本模型"} count={text_models.length} model={default_text} models={text_models} active_model_id={controller.settings.default_text_model_id} on_select={(model_id) => void controller.update_settings({ default_text_model_id: model_id })} empty_text="暂无文本模型" on_info={(model) => set_selected_model(model)} /><button type="button" className="flex min-h-11 w-full items-center gap-2 border-t border-divider px-3.5 py-2.5 text-left text-xs text-foreground/85 hover:bg-interaction-hover" aria-expanded={pricing_expanded} onClick={() => set_pricing_expanded((current) => !current)}><TbChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", pricing_expanded && "rotate-90")} /><span className="min-w-0 flex-1">价格对比</span><span className="text-[10px] text-muted-foreground/70">USD / 1M tokens · {pricing.length}</span></button>{pricing_expanded ? <div className="border-t border-divider px-3.5 py-4">{pricing.length ? <ModelPricingChart data={pricing} /> : <div className="py-5 text-center text-xs text-muted-foreground/70">暂无可比较的模型价格</div>}</div> : null}</SettingGroup></SettingSection>
    <SettingSection title="生图模型"><SettingGroup><CollapsibleModelGroup title={default_image?.name || "暂无生图模型"} count={image_models.length} model={default_image} models={image_models} active_model_id={controller.settings.default_image_model_id} on_select={(model_id) => void controller.update_settings({ default_image_model_id: model_id })} empty_text="暂无生图模型" on_info={(model) => set_selected_model(model)} /><ModelPricingDisclosure data={image_pricing} expanded={image_pricing_expanded} on_expanded_change={set_image_pricing_expanded} /></SettingGroup></SettingSection>
    <Dialog open={Boolean(selected_model)} onOpenChange={(open) => { if (!open) set_selected_model(undefined); }}><DialogContent><ModelDetailsDialog model={selected_model} /></DialogContent></Dialog>
  </>}</SettingsContainer>;
}
function CollapsibleModelGroup({ title, count, model, models, active_model_id, on_select, empty_text, on_info }: { title: string; count: number; model?: DesktopViewController["models"][number]; models: DesktopViewController["models"]; active_model_id: string; on_select(model_id: string): void; empty_text: string; on_info(model: DesktopViewController["models"][number]): void }) { const [expanded, set_expanded] = useState(false); return <div className="overflow-hidden"><button type="button" className="flex min-h-12 w-full items-center gap-2 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover" onClick={() => set_expanded((current) => !current)}><TbChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />{model ? <LLMModelIcon model_id={model.model_id} size_class="size-4" /> : null}<span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{title}</span><span className="text-[10px] tabular-nums text-muted-foreground/70">{count}</span></button>{expanded ? <div className="divide-y divide-divider border-t border-divider">{models.length ? models.map((item) => <ModelRowExact key={item.model_id} model={item} active={item.model_id === active_model_id || (!active_model_id && item.model_id === model?.model_id)} on_select={() => on_select(item.model_id)} on_info={() => on_info(item)} />) : <div className="flex min-h-16 items-center justify-center px-3 py-3 text-center text-xs text-muted-foreground/70">{empty_text}</div>}</div> : null}</div>; }
function ModelRowExact({ model, active, on_select, on_info }: { model: DesktopViewController["models"][number]; active: boolean; on_select(): void; on_info(): void }) { const reasoning_label = format_model_reasoning(model); return <div className={cn("group flex min-h-10 w-full items-center gap-2 px-3.5 py-1 transition-colors hover:bg-interaction-hover", active && "bg-interaction-selected hover:bg-interaction-active")}><button type="button" onClick={on_select} aria-pressed={active} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left"><LLMModelIcon model_id={model.model_id} size_class="size-4" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground/90">{model.name}</span>{reasoning_label ? <span className="block truncate text-[10px] text-muted-foreground/70">{reasoning_label}</span> : null}</span></button><div className="flex shrink-0 items-center gap-1">{model.context_window ? <span className="rounded bg-foreground/[0.04] px-1.5 text-[10px] leading-4 text-muted-foreground/75 tabular-nums">{format_context_window(model.context_window)}</span> : null}<button type="button" className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-interaction-hover hover:text-foreground" aria-label={`查看 ${model.name} 详情`} title="查看模型详情" onClick={on_info}><TbInfoCircle className="size-3.5" /></button><TbCheck className={cn("size-4 text-foreground transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden="true" /></div></div>; }
function ModelDetailsDialog({ model }: { model?: DesktopViewController["models"][number] }) { if (!model) return null; const pricing = build_model_pricing([model])[0]; const reasoning_label = format_model_reasoning(model); const default_effort = get_default_model_reasoning(model); return <><DialogHeader><DialogTitle>{model.name}</DialogTitle><DialogDescription>{model.description || model.model_id}</DialogDescription></DialogHeader><DialogBody className="flex flex-col gap-3"><div className="grid grid-cols-2 gap-2 text-xs"><DetailRow label="模型 ID" value={model.model_id} /><DetailRow label="上下文窗口" value={model.context_window ? format_context_window(model.context_window) : "未提供"} /><DetailRow label="能力" value={model.modalities.join(" / ") || "未提供"} /><DetailRow label="推理强度" value={reasoning_label || "不支持可配置推理"} />{default_effort ? <DetailRow label="默认档位" value={default_effort.name} /> : null}<DetailRow label="价格单位" value="USD / 1M tokens" /></div><div className="rounded-lg bg-muted/45 px-3 py-2.5 text-xs"><div className="mb-2 text-muted-foreground">价格</div>{pricing ? <div className="grid grid-cols-2 gap-2"><DetailRow label="输入" value={`$${format_usd(pricing.input_usd_per_1m)}`} /><DetailRow label="输出" value={`$${format_usd(pricing.output_usd_per_1m)}`} /></div> : <div className="text-muted-foreground">暂无可解析的输入/输出价格</div>}</div></DialogBody></>; }
function ModelPricingDisclosure({ data, expanded, on_expanded_change }: { data: ReturnType<typeof build_model_pricing>; expanded: boolean; on_expanded_change(expanded: boolean): void }) { return <><button type="button" className="flex min-h-11 w-full items-center gap-2 border-t border-divider px-3.5 py-2.5 text-left text-xs text-foreground/85 hover:bg-interaction-hover" aria-expanded={expanded} onClick={() => on_expanded_change(!expanded)}><TbChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")} /><span className="min-w-0 flex-1">价格对比</span><span className="text-[10px] text-muted-foreground/70">USD / 1M tokens · {data.length}</span></button>{expanded ? <div className="border-t border-divider px-3.5 py-4">{data.length ? <ModelPricingChart data={data} /> : <div className="py-5 text-center text-xs text-muted-foreground/70">暂无可比较的模型价格</div>}</div> : null}</>; }
function DetailRow({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-0.5 truncate text-foreground/85" title={value}>{value}</div></div>; }

/** 通用设置。 */
function GeneralSettings({ controller }: { /** Renderer 根控制器。 */ controller: DesktopViewController }) {
  return <SettingsContainer>
    <SettingsHeader title="通用" description="Desktop 启动和默认导航偏好。" />
    <SettingSection title="启动">
      <SettingGroup>
        <SettingRow label="默认 Agent" description="启动时优先打开该 Agent。">
          <SettingSelect value={controller.settings.default_agent_id} label={controller.settings.default_agent_id || "列表中的第一个"} options={[{ value: "", label: "列表中的第一个" }, ...controller.agents.map((agent) => ({ value: agent.agent_id, label: agent.agent_id }))]} on_change={(value) => void controller.update_settings({ default_agent_id: value })} />
        </SettingRow>
        <SettingRow label="启动时打开空对话" description="进入默认 Agent 后直接显示尚未创建的空对话。"><SettingSwitch checked={controller.settings.open_empty_chat_on_start} label="启动时打开空对话" on_change={(checked) => void controller.update_settings({ open_empty_chat_on_start: checked })} /></SettingRow>
      </SettingGroup>
    </SettingSection>
    <SettingSection title="网络代理" description="应用于 Desktop 发起的 Federation 与网页请求。">
      <SettingGroup>
        <SettingRow label="启用代理" description="使用 HTTP、HTTPS 或 SOCKS 代理。"><SettingSwitch checked={controller.settings.proxy_enabled} label="启用代理" on_change={(checked) => void controller.update_settings({ proxy_enabled: checked })} /></SettingRow>
        <SettingRow label="代理地址" description="例如 http://127.0.0.1:7890。">
          <input className="h-8 w-56 rounded-md bg-background px-2 text-xs ring-1 ring-border focus:ring-foreground/20" defaultValue={controller.settings.proxy_url} placeholder="http://127.0.0.1:7890" onBlur={(event) => void controller.update_settings({ proxy_url: event.target.value })} />
        </SettingRow>
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
function AppearanceSettings({ controller }: { /** Renderer 根控制器。 */ controller: DesktopViewController }) {
  return <SettingsContainer>
    <SettingsHeader title="外观" description="控制 Desktop 的明暗模式、颜色主题与界面缩放。" />
    <SettingSection title="全局">
      <SettingGroup>
        <SettingRow label="外观模式" description="跟随系统或固定使用明亮、深色模式。">
          <SegmentedControl
            value={controller.settings.appearance_mode}
            aria_label="外观模式"
            options={[{ value: "light", label: "明亮" }, { value: "dark", label: "深色" }, { value: "system", label: "系统" }]}
            on_value_change={(appearance_mode) => void controller.update_settings({ appearance_mode })}
          />
        </SettingRow>
        <SettingRow label="颜色主题" description="选择 Duobox 提供的界面配色。">
          <SettingSelect value={controller.settings.color_theme} label={theme_options.find(([value]) => value === controller.settings.color_theme)?.[1] || "Duobox"} options={theme_options.map(([value, label]) => ({ value, label }))} on_change={(value) => void controller.update_settings({ color_theme: value as typeof controller.settings.color_theme })} />
        </SettingRow>
        <SettingRow label="界面缩放" description="同时调整导航、对话和设置的显示密度。">
          <div className="flex items-center gap-2">
            <Slider value={controller.settings.ui_scale} min={0.85} max={1.2} step={0.05} aria-label="界面缩放" on_value_change={(ui_scale) => void controller.update_settings({ ui_scale })} />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(controller.settings.ui_scale * 100)}%</span>
            <Button size="icon" title="恢复默认缩放" onClick={() => void controller.update_settings({ ui_scale: 1 })}><TbRotate /></Button>
          </div>
        </SettingRow>
      </SettingGroup>
    </SettingSection>
  </SettingsContainer>;
}

/** Federation 模型目录设置。 */
function ModelSettings({ controller }: { /** Renderer 根控制器。 */ controller: DesktopViewController }) {
  const text_models = controller.models.filter(is_text_model);
  const image_models = controller.models.filter(is_image_model);
  return <SettingsContainer>
    <SettingsHeader title="模型" description="管理文本与生图模型，并选择新对话的默认模型。" />
    <SettingSection title="文本模型" description="用于 Agent 对话和 Chat 输入框。">
      <SettingGroup>
        <ModelToolbar count={text_models.length} controller={controller} />
        <DefaultModelRow label="默认文本模型" value={controller.settings.default_text_model_id} models={text_models} on_change={(value) => void controller.update_settings({ default_text_model_id: value })} />
        {text_models.map((model) => <div key={model.model_id} className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.055]"><TbCpu /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px]">{model.name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{model.model_id}{model.context_window ? ` · ${Math.round(model.context_window / 1000)}K context` : ""}</span></span>
          <span className="max-w-48 truncate text-[10px] text-muted-foreground/70">{model.modalities.join(" / ")}</span>
        </div>)}
        {!controller.models_loading && text_models.length === 0 ? <div className="px-4 py-10 text-center text-xs text-muted-foreground">{controller.user.authenticated ? "Federation 暂无可用文本模型" : "登录 Federation 后读取模型"}</div> : null}
      </SettingGroup>
    </SettingSection>
    <SettingSection title="生图模型" description="用于图像生成能力；没有生图模型时不会显示此分组。"><SettingGroup><DefaultModelRow label="默认生图模型" value={controller.settings.default_image_model_id} models={image_models} on_change={(value) => void controller.update_settings({ default_image_model_id: value })} />{image_models.map((model) => <div key={model.model_id} className="flex min-h-14 items-center gap-3 px-3.5 py-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/[0.055]"><TbCpu /></span><span className="min-w-0 flex-1"><span className="block truncate text-[13px]">{model.name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{model.model_id}</span></span></div>)}{!controller.models_loading && image_models.length === 0 ? <div className="px-4 py-8 text-center text-xs text-muted-foreground">暂无生图模型</div> : null}</SettingGroup></SettingSection>
  </SettingsContainer>;
}

function ModelToolbar({ count, controller }: { count: number; controller: DesktopViewController }) { return <div className="flex min-h-12 items-center justify-between px-3.5 py-2.5"><span className="text-xs text-muted-foreground">{count} 个模型</span><Button disabled={controller.models_loading || !controller.user.authenticated} onClick={() => void controller.refresh_models()}>{controller.models_loading ? <TbLoader2 className="animate-spin" /> : <TbRefresh />}刷新</Button></div>; }
function DefaultModelRow({ label, value, models, on_change }: { label: string; value: string; models: DesktopViewController["models"]; on_change(value: string): void }) { return <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border/45 px-3.5 py-2.5"><span className="text-xs text-muted-foreground">{label}</span><SettingSelect value={value} label={models.find((model) => model.model_id === value)?.name || "自动选择"} options={[{ value: "", label: "自动选择" }, ...models.map((model) => ({ value: model.model_id, label: model.name }))]} on_change={on_change} /></div>; }

/** Chat 展示设置。 */
function ChatSettings({ controller }: { /** Renderer 根控制器。 */ controller: DesktopViewController }) {
  return <SettingsContainer>
    <SettingsHeader title="对话" description="控制实时消息的展示和滚动行为。" />
    <SettingSection title="消息">
      <SettingGroup>
        <SettingRow label="显示思考过程" description="在 Assistant 消息中展示可折叠的 reasoning 内容。"><SettingSwitch checked={controller.settings.show_reasoning} label="显示思考过程" on_change={(checked) => void controller.update_settings({ show_reasoning: checked })} /></SettingRow>
        <SettingRow label="自动跟随输出" description="位于对话底部时跟随流式消息滚动。"><SettingSwitch checked={controller.settings.auto_scroll} label="自动跟随输出" on_change={(checked) => void controller.update_settings({ auto_scroll: checked })} /></SettingRow>
      </SettingGroup>
    </SettingSection>
    <SettingSection title="输入">
      <SettingGroup>
        <SettingRow label="Enter 发送消息" description="关闭后使用 Command/Ctrl + Enter 发送。"><SettingSwitch checked={controller.settings.send_message_on_enter} label="Enter 发送消息" on_change={(checked) => void controller.update_settings({ send_message_on_enter: checked })} /></SettingRow>
        <SettingRow label="系统拼写检查" description="在 Chat 输入框中显示操作系统拼写提示。"><SettingSwitch checked={controller.settings.spellcheck_enabled} label="系统拼写检查" on_change={(checked) => void controller.update_settings({ spellcheck_enabled: checked })} /></SettingRow>
      </SettingGroup>
    </SettingSection>
  </SettingsContainer>;
}

/** 设置页面内容容器。 */
function SettingsContainer({ children }: { /** 设置内容。 */ children: ReactNode }) {
  return <div className="flex flex-col gap-7">{children}</div>;
}

/** 设置页标题。 */
function SettingsHeader({ title, description }: { /** 标题。 */ title: string; /** 描述。 */ description: string }) {
  return <header><h1 className="text-lg font-semibold text-foreground">{title}</h1><p className="mt-1 text-xs text-muted-foreground">{description}</p></header>;
}

/** 设置分区。 */
function SettingSection({ title, description, action, children }: { /** 分区标题。 */ title?: string; /** 分区描述。 */ description?: string; /** 标题右侧操作。 */ action?: ReactNode; /** 分区内容。 */ children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-2">{title ? <header className="flex items-start justify-between gap-3 px-2"><div className="min-w-0"><h2 className="text-xs font-normal text-muted-foreground">{title}</h2>{description ? <p className="mt-0.5 text-[0.6875rem] text-muted-foreground/75">{description}</p> : null}</div>{action ? <div className="shrink-0">{action}</div> : null}</header> : null}{children}</section>;
}

/** 设置项分组。 */
function SettingGroup({ children }: { /** 分组内容。 */ children: ReactNode }) {
  return <div className="min-w-0 divide-y divide-border/45 overflow-hidden rounded-lg bg-surface-subtle">{children}</div>;
}

/** 带尾部控件的设置行。 */
function SettingRow({ label, description, children }: { /** 设置名称。 */ label: string; /** 设置说明。 */ description: string; /** 控件。 */ children: ReactNode }) {
  return <div className="flex min-h-14 items-center justify-between gap-6 px-3.5 py-2.5"><div className="min-w-0 flex-1"><div className="text-[0.8125rem]">{label}</div><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div><div className="shrink-0">{children}</div></div>;
}

/** 设置命令行。 */
function SettingAction({ label, description, icon, destructive, on_click }: { /** 命令名称。 */ label: string; /** 命令说明。 */ description: string; /** 图标。 */ icon: ReactNode; /** 是否危险操作。 */ destructive?: boolean; /** 执行命令。 */ on_click(): void }) {
  return <button type="button" onClick={on_click} className={cn("flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-foreground/[0.035]", destructive && "text-destructive")}><span className="flex size-5 items-center justify-center">{icon}</span><span className="min-w-0 flex-1"><span className="block text-[0.8125rem]">{label}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span></span></button>;
}

/** 二元设置开关。 */
function SettingSwitch({ checked, label, on_change }: { /** 当前值。 */ checked: boolean; /** 无障碍标签。 */ label: string; /** 修改值。 */ on_change(checked: boolean): void }) {
  return <Switch checked={checked} aria-label={label} onCheckedChange={on_change} />;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 text-sm font-medium tabular-nums">{value}</div></div>; }
function SettingSelect({ value, label, options, on_change }: { value: string; label: string; options: Array<{ value: string; label: string }>; on_change(value: string): void }) { return <Select value={value} options={options} align="end" aria-label={label} className="min-w-40 max-w-56" on_value_change={on_change} />; }
function is_image_model(model: { modalities: string[]; model_id: string }): boolean { return model.modalities.some((modality) => modality.toLowerCase().includes("image")) || model.model_id.toLowerCase().includes("image"); }
function is_text_model(model: { modalities: string[] }): boolean { return model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality.toLowerCase())); }
function format_credits(value: number): string { return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function format_compact(value: number): string { return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function format_date(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function format_context_window(value: number): string { return value >= 1000 ? `${Math.round(value / 1000)}K context` : `${value} context`; }
function format_usd(value: number): string { return value.toLocaleString(undefined, { maximumSignificantDigits: 3 }); }
