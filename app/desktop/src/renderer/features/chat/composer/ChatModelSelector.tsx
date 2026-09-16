/** ChatInput 使用的模型与推理强度 submenu 选择器。 */

import { PreviewCard } from "@base-ui/react/preview-card";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { TbCheck, TbChevronRight, TbLoader2, TbSearch } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { menu_item_base_class_name, menu_item_highlighted_class_name, menu_item_interaction_class_name } from "@/components/ui/menu-styles";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DesktopAgentSummary, DesktopModelSummary, DesktopSessionConfiguration } from "@common/types/DesktopApi";
import { LLMModelIcon } from "@/components/model";
import { build_model_pricing } from "@/lib/model/model_pricing";
import { format_token_count, format_usd_price } from "@/lib/model/model_format";
import { format_model_reasoning, get_default_model_reasoning } from "@/lib/model/model_reasoning";
import { use_translation } from "@/locales/i18n";

interface ChatModelSelectorProps {
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** 当前 Session 配置。 */ configuration?: DesktopSessionConfiguration;
  /** Federation 模型目录。 */ models: DesktopModelSummary[];
  /** 目录是否正在加载。 */ models_loading: boolean;
  /** 切换模型。 */ set_model(model_id: string): Promise<void>;
  /** 切换推理强度。 */ set_reasoning_effort(reasoning_effort?: string): Promise<void>;
}

/** 以一个主 dropdown 承载两个可进入的 submenu。 */
export function ChatModelSelector(props: ChatModelSelectorProps) {
  const translate = use_translation("chat");
  const common_translate = use_translation();
  const current_model_id = props.configuration?.model_id || props.agent.model_id;
  const text_models = useMemo(() => props.models.filter(is_text_model), [props.models]);
  const current_model = text_models.find((model) => model.model_id === current_model_id);
  const selected_effort = current_model?.reasoning?.efforts.find((effort) => effort.id === props.configuration?.reasoning_effort);
  const trigger_label = props.models_loading && !current_model_id ? translate("model.loading") : current_model?.name || current_model_id || common_translate("state.not_configured");
  const trigger_accessible_label = selected_effort?.name ? `${trigger_label}, ${translate("model.reasoning")}: ${selected_effort.name}` : trigger_label;

  return <Popover>
    <PopoverTrigger asChild><Button className="min-w-0 max-w-64 justify-start rounded-full" title={trigger_accessible_label} aria-label={trigger_accessible_label} disabled={props.models_loading && !current_model_id}>{props.models_loading && !current_model_id ? <TbLoader2 className="size-4 animate-spin" /> : <LLMModelIcon model_id={current_model?.model_id || current_model_id} model_name={current_model?.name} tags={current_model?.tags} size_class="size-4" />}<span className="min-w-0 flex-1 truncate">{trigger_label}</span>{selected_effort?.name ? <span className="max-w-20 shrink-0 truncate rounded-full bg-surface-emphasis px-1.5 py-0.5 text-[0.625rem] font-medium leading-none text-muted-foreground">{selected_effort.name}</span> : null}</Button></PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={4} className="w-64 max-w-[calc(100vw-1rem)] p-1">
      <SelectorSubmenu label={translate("model.model")} value={current_model?.name || current_model_id || common_translate("state.not_configured")}>
        <ModelOptions models={text_models} current_model_id={current_model_id} loading={props.models_loading} on_select={props.set_model} />
      </SelectorSubmenu>
      {current_model?.reasoning?.efforts.length ? <SelectorSubmenu label={translate("model.reasoning")} value={selected_effort?.name || common_translate("state.automatic")}>
        <ReasoningOptions efforts={current_model.reasoning.efforts} selected_effort={props.configuration?.reasoning_effort} on_select={props.set_reasoning_effort} />
      </SelectorSubmenu> : null}
    </PopoverContent>
  </Popover>;
}

/** 主菜单中的 submenu 入口。 */
function SelectorSubmenu({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const [open, set_open] = useState(false);
  return <Popover open={open} onOpenChange={set_open}>
    <PopoverTrigger asChild><button type="button" className={cn("flex min-h-10 w-full items-center gap-2 rounded-floating-item px-2.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:ring-2 focus-visible:ring-ring/30", open && "bg-interaction-selected")}><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-foreground">{label}</span><span className="block truncate text-[0.625rem] text-muted-foreground">{value}</span></span><TbChevronRight className="size-3.5 shrink-0 text-subtle-foreground" /></button></PopoverTrigger>
    {/* 高度上限取「视口 80%」与「锚点上方可用空间」的较小值，超出部分由列表内部滚动，避免溢出屏幕。 */}
    <PopoverContent side="right" align="start" sideOffset={4} className="flex max-h-[min(80vh,var(--available-height,100vh))] w-72 max-w-[calc(100vw-1rem)] flex-col">
      {children}
    </PopoverContent>
  </Popover>;
}

/** 带顶部搜索的模型目录列表。 */
function ModelOptions({ models, current_model_id, loading, on_select }: { models: DesktopModelSummary[]; current_model_id: string; loading: boolean; on_select(model_id: string): Promise<void> }) {
  const translate = use_translation("chat");
  const [query, set_query] = useState("");
  const input_ref = useRef<HTMLInputElement>(null);
  const list_ref = useRef<HTMLDivElement>(null);
  const filtered_models = useMemo(() => filter_models(models, query), [models, query]);
  // submenu 每次展开都重新聚焦搜索框，用户进入后可直接输入筛选。
  useEffect(() => { input_ref.current?.focus(); }, []);

  const handle_key_down = (event: KeyboardEvent<HTMLInputElement>) => {
    // 向下键把焦点交给列表首项，后续移动与选中交给原生按钮行为。
    if (event.key === "ArrowDown") {
      const first_item = list_ref.current?.querySelector<HTMLButtonElement>("button");
      if (!first_item) return;
      event.preventDefault();
      first_item.focus();
      return;
    }
    // 回车直接选中首个匹配项，省去从搜索结果再点一次。
    if (event.key === "Enter") {
      const target_model = filtered_models[0];
      if (!target_model) return;
      event.preventDefault();
      void on_select(target_model.model_id);
    }
  };

  if (loading && models.length === 0) return <div className="flex min-h-20 items-center justify-center gap-2 text-xs text-muted-foreground"><TbLoader2 className="size-4 animate-spin" />{translate("model.loading")}</div>;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center gap-2 px-2 pb-1">
      <TbSearch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input ref={input_ref} value={query} aria-label={translate("model.search_placeholder")} placeholder={translate("model.search_placeholder")} spellCheck={false} className="h-6 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" onChange={(event) => set_query(event.target.value)} onKeyDown={handle_key_down} />
    </div>
    <div className="-mx-1 h-px shrink-0 bg-divider" />
    {filtered_models.length === 0 ? <div className="px-2 py-4 text-center text-xs text-muted-foreground">{translate(query.trim() ? "model.no_match" : "model.empty")}</div> : <div ref={list_ref} className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {filtered_models.map((model) => {
        const active = model.model_id === current_model_id;
        return <PreviewCard.Root key={model.model_id}>
          <PreviewCard.Trigger delay={300} closeDelay={120} render={<button type="button" aria-pressed={active} title={model.name} className={cn(menu_item_base_class_name, active ? menu_item_highlighted_class_name : menu_item_interaction_class_name)} onClick={() => void on_select(model.model_id)} />}>
            <LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{model.name}</span>
            {active ? <TbCheck className="ml-auto text-primary" /> : null}
          </PreviewCard.Trigger>
          <ModelPreview model={model} />
        </PreviewCard.Root>;
      })}
    </div>}
  </div>;
}

/** 按名称与 model_id 做大小写不敏感的子串筛选。 */
function filter_models(models: DesktopModelSummary[], query: string): DesktopModelSummary[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return models;
  return models.filter((model) => `${model.name} ${model.model_id}`.toLowerCase().includes(keyword));
}

/** 模型条目悬停或聚焦时展示的只读详情卡。 */
function ModelPreview({ model }: { /** 当前模型目录信息。 */ model: DesktopModelSummary }) {
  const translate = use_translation("chat");
  const common_translate = use_translation();
  const pricing = build_model_pricing([model])[0];
  const reasoning_label = format_model_reasoning(model);
  const default_effort = get_default_model_reasoning(model);
  return <PreviewCard.Portal>
    <PreviewCard.Positioner side="right" align="start" sideOffset={8} collisionPadding={12} className="z-[60] outline-none">
      {/* 圆角与滚动分两层：圆角只对外层生效，否则滚动条会戳出圆角（原因见 ui/menu-styles 的注释）。 */}
      <PreviewCard.Popup className="w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-background text-foreground outline-none data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 data-[side=right]:slide-in-from-left-1 duration-150">
        <div className="max-h-[min(60vh,var(--available-height,100vh))] overflow-y-auto overscroll-contain p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle"><LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{model.name}</span><span className="mt-0.5 block truncate font-mono text-[0.625rem] text-muted-foreground">{model.model_id}</span></span>
        </div>
        {model.description ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{model.description}</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-surface-subtle p-2.5 text-[0.6875rem]">
          <ModelDetail label={translate("model.context")} value={model.context_window ? format_token_count(model.context_window) : translate("model.not_provided")} />
          <ModelDetail label={translate("model.capabilities")} value={model.modalities.join(" / ") || translate("model.not_provided")} />
          <ModelDetail label={translate("model.reasoning")} value={reasoning_label || translate("model.not_supported")} />
          <ModelDetail label={translate("model.default_effort")} value={default_effort?.name || common_translate("state.automatic")} />
        </dl>
        <div className="mt-3 flex items-center gap-2 text-[0.6875rem]">
          <span className="text-muted-foreground">{translate("model.price")}</span>
          <span className="ml-auto tabular-nums text-foreground">{pricing ? translate("model.price_detail", { input: format_usd_price(pricing.input_usd_per_1m), output: format_usd_price(pricing.output_usd_per_1m) }) : translate("model.not_provided")}</span>
        </div>
        {model.tags.length ? <div className="mt-3 flex flex-wrap gap-1">{model.tags.map((tag) => <span key={tag} className="rounded-md bg-surface-subtle px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">{tag}</span>)}</div> : null}
        </div>
      </PreviewCard.Popup>
    </PreviewCard.Positioner>
  </PreviewCard.Portal>;
}

/** 详情卡中的紧凑键值信息。 */
function ModelDetail({ label, value }: { /** 字段名称。 */ label: string; /** 字段值。 */ value: string }) {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate text-foreground" title={value}>{value}</dd></div>;
}


function ReasoningOptions({ efforts, selected_effort, on_select }: { efforts: NonNullable<DesktopModelSummary["reasoning"]>["efforts"]; selected_effort?: string; on_select(effort?: string): Promise<void> }) {
  return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{efforts.map((effort) => {
    const active = effort.id === selected_effort;
    return <button key={effort.id} type="button" aria-pressed={active} onClick={() => void on_select(effort.id)} className={cn(menu_item_base_class_name, active ? menu_item_highlighted_class_name : menu_item_interaction_class_name)}>
      <span className="min-w-0 flex-1 truncate">{effort.name}</span>
      {effort.description ? <span className="sr-only">{effort.description}</span> : null}
      {active ? <TbCheck className="ml-auto text-primary" /> : null}
    </button>;
  })}</div>;
}

/** 判断模型是否支持 Agent 文本对话。 */
function is_text_model(model: DesktopModelSummary): boolean { return model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality.toLowerCase())); }
