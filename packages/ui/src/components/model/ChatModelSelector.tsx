"use client";
import { same_model } from "@downcity/type";
/** 聊天与 Agent 创建共用的模型菜单；仅在场景提供保存能力时展示推理强度。 */

import { PreviewCard } from "@base-ui/react/preview-card";
import { use_theme_portal_container } from "../theme-container";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelReference } from "@downcity/type";
import type { KeyboardEvent } from "react";
import { TbCheck, TbChevronRight, TbLoader2, TbSearch } from "react-icons/tb";
import { InputGroup, InputGroupInput } from "../input-group";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "../select";
import { chat_model_trigger_class_name, model_field_surface_class_name, model_popover_class_name, model_preview_class_name, model_menu_item_class_name, model_menu_selected_class_name, model_menu_interaction_class_name, model_field_item_class_name, model_field_selected_class_name } from "./model-control-styles";

import { Button } from "../button";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { cn } from "../../lib/utils";
import type { ModelSummary, ChatModelSelectorProps, ModelOptionsProps, ReasoningOptionsProps, SelectorSubmenuProps, ModelDetailsProps, ModelDetailProps } from "../../types/model-controls";
import { LLMModelIcon } from "./LLMModelIcon";
import { build_model_pricing } from "../../lib/model/model_pricing";
import { format_token_count, format_usd_price } from "../../lib/model/model_format";
import { format_model_reasoning, get_default_model_reasoning } from "../../lib/model/model_reasoning";
import { is_text_model } from "../../lib/model/model_selection";
import { ControlMessagesProvider, use_control_translation as use_translation } from "../../lib/control-messages";

/** 以一个主 dropdown 承载两个可进入的 submenu。 */
function ChatModelSelectorContent(props: ChatModelSelectorProps) {
  const translate = use_translation("chat");
  const common_translate = use_translation("common");
  const selected_model = props.configuration.model;
  const text_models = useMemo(() => props.models.filter(is_text_model), [props.models]);
  const current_model = text_models.find((model) => same_model(model.model, selected_model));
  const selected_effort = props.set_reasoning_effort ? current_model?.reasoning?.efforts.find((effort) => effort.id === props.configuration.reasoning_effort) : undefined;
  const trigger_label = props.models_loading && !selected_model ? translate("model.loading") : current_model?.name || selected_model?.id || translate("model.select");
  const trigger_accessible_label = selected_effort?.name ? `${trigger_label}, ${translate("model.reasoning")}: ${selected_effort.name}` : trigger_label;

  const [open, set_open] = useState(false);

  return <Popover open={open} onOpenChange={set_open}>
    <PopoverTrigger render={<Button variant="ghost" size="default" data-popup-open={open || undefined} className={cn(chat_model_trigger_class_name, "max-w-64 flex-none justify-start whitespace-nowrap")} title={trigger_accessible_label} aria-label={trigger_accessible_label} disabled={props.models_loading && !selected_model}>{props.models_loading && !selected_model ? <TbLoader2 className="size-4 animate-spin" /> : <LLMModelIcon model_id={current_model?.id || selected_model?.id || ""} model_name={current_model?.name} tags={current_model?.tags} size_class="size-4" />}<span className="min-w-0 flex-1 truncate">{trigger_label}</span>{selected_effort?.name ? <span className="max-w-20 shrink-0 truncate rounded-full bg-surface-emphasis px-1.5 py-0.5 text-3xs font-medium leading-none text-muted-foreground">{selected_effort.name}</span> : null}</Button>} />
    <PopoverContent side="top" align="start" sideOffset={4} className={cn(model_popover_class_name, "w-64 max-w-[calc(100vw-1rem)] p-1")}>
      <SelectorSubmenu label={translate("model.model")} value={current_model?.name || selected_model?.id || translate("model.select")}>
        <ModelOptions models={text_models} selected_model={selected_model} loading={props.models_loading} on_select={props.set_model} favorite_models={props.favorite_models} recent_models={props.recent_models} />
      </SelectorSubmenu>
      {props.set_reasoning_effort && current_model?.reasoning?.efforts.length ? <SelectorSubmenu label={translate("model.reasoning")} value={selected_effort?.name || common_translate("state.automatic")}>
        <ReasoningOptions efforts={current_model.reasoning.efforts} selected_effort={props.configuration?.reasoning_effort} on_select={props.set_reasoning_effort} />
      </SelectorSubmenu> : null}
    </PopoverContent>
  </Popover>;
}

/** 主菜单中的 submenu 入口。 */
export function SelectorSubmenu({ label, value, children }: SelectorSubmenuProps) {
  const [open, set_open] = useState(false);
  return <Popover open={open} onOpenChange={set_open}>
    <PopoverTrigger render={<button type="button" className={cn("flex min-h-10 w-full items-center gap-2 rounded-item px-2.5 text-left outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover", open && "bg-interaction-selected")}><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-foreground">{label}</span><span className="block truncate text-3xs text-muted-foreground">{value}</span></span><TbChevronRight className="size-3.5 shrink-0 text-subtle-foreground" /></button>} />
    {/* 外层仅限高与裁剪；搜索区和滚动内容分别留白，让滚动条贴齐浮层内边缘。 */}
    <PopoverContent side="right" align="start" sideOffset={4} className={cn(model_popover_class_name, "flex max-h-[min(80vh,var(--available-height,100vh))] w-72 max-w-[calc(100vw-1rem)] flex-col")}>
      {children}
    </PopoverContent>
  </Popover>;
}

/** 带顶部搜索的模型目录列表。 */
function ModelOptionsContent({ models, selected_model, loading, on_select, empty_text, variant = "menu", favorite_models = [], recent_models = [] }: ModelOptionsProps) {
  const translate = use_translation("chat");
  const [query, set_query] = useState("");
  const input_ref = useRef<HTMLInputElement>(null);
  const list_ref = useRef<HTMLDivElement>(null);
  const [browse_all, set_browse_all] = useState(false);
  const source_key = (model: ModelSummary) => model_source_key(model.model);
  const sources = useMemo(() => [...new Map(models.map((model) => [source_key(model), model.source_name || ("downtown" in model.model ? model.model.downtown : translate("model.local_source"))])).entries()], [models, translate]);
  const saved_source = selected_model ? model_source_key(selected_model) : "";
  const [source_filter, set_source_filter] = useState(() => saved_source || (sources.length === 1 ? sources[0][0] : ""));
  const selected_key = JSON.stringify(selected_model ?? null);
  const observed_selection = useRef(selected_key);
  useEffect(() => {
    // 只有实际配置改变才重置浏览范围；普通目录刷新不覆盖用户当前浏览的 Town。
    if (observed_selection.current !== selected_key) {
      observed_selection.current = selected_key;
      set_source_filter(saved_source || (sources.length === 1 ? sources[0][0] : ""));
      set_query(""); set_browse_all(false);
    } else if (!source_filter && !selected_model && sources.length === 1) set_source_filter(sources[0][0]);
  }, [selected_key, saved_source, sources, source_filter, selected_model]);
  // 暂存来源名称只用于离线状态展示，不推断目录或替换已保存引用。
  const source_labels = useRef(new Map<string, string>());
  for (const [id, name] of sources) source_labels.current.set(id, name);
  const retained_sources = [...new Set([saved_source, source_filter].filter(Boolean))].filter((id) => !sources.some(([source_id]) => source_id === id));
  const source_options = [...retained_sources.map((value) => ({ value, label: `${source_labels.current.get(value) || (selected_model && "downtown" in selected_model ? selected_model.downtown : translate("model.local_source"))} · ${translate("model.unavailable")}` })), ...sources.map(([value, label]) => ({ value, label }))];
  const effective_source = source_filter;
  const shortlist = useMemo(() => {
    const recent_scope = recent_models.filter((entry) => model_source_key(entry) === effective_source).slice(0, 5);
    return [selected_model, ...favorite_models, ...recent_scope].filter((entry, index, all) => entry && model_source_key(entry) === effective_source && all.findIndex((other) => same_model(entry, other)) === index);
  }, [selected_model, favorite_models, recent_models, effective_source]);
  const has_shortlist = shortlist.some((entry) => models.some((model) => same_model(model.model, entry)));
  const full_catalog = browse_all || Boolean(query.trim()) || !has_shortlist;
  const scroll_positions = useRef({ shortlist: 0, catalog: 0 });
  useEffect(() => {
    if (list_ref.current) list_ref.current.scrollTop = scroll_positions.current[full_catalog ? "catalog" : "shortlist"];
  }, [full_catalog, effective_source]);
  const filtered_models = useMemo(() => {
    const result = filter_models(models, query).filter((model) => source_key(model) === effective_source);
    return full_catalog ? [...result].sort((left, right) => (left.source_name ?? "").localeCompare(right.source_name ?? "") || (left.source_id ?? "").localeCompare(right.source_id ?? "") || left.name.localeCompare(right.name)) : shortlist.flatMap((id) => result.filter((model) => same_model(model.model, id)));
  }, [models, query, effective_source, full_catalog, shortlist]);
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
      void on_select(target_model.model);
    }
  };

  if (loading && models.length === 0 && !selected_model) return <div className="flex min-h-20 items-center justify-center gap-2 text-xs text-muted-foreground"><TbLoader2 className="size-4 animate-spin" />{translate("model.loading")}</div>;

  return <div className="flex min-h-0 flex-1 flex-col">
    {source_options.length ? <div className="mx-1 mb-1"><Select items={source_options} value={effective_source} onValueChange={(value) => { if (value) { set_source_filter(value); set_query(""); set_browse_all(false); } }}><SelectTrigger size="sm" className="w-full" aria-label={translate("model.source")}><SelectValue placeholder={translate("model.source")} /></SelectTrigger><SelectContent><SelectGroup>{source_options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></div> : null}
    <div className="shrink-0 p-1">
      <InputGroup className={cn(model_field_surface_class_name, "h-8 min-h-0 w-full gap-2 px-2.5 text-xs leading-5")}>
        <TbSearch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <InputGroupInput className="h-full p-0 text-xs leading-5 placeholder:text-[var(--field-placeholder,var(--text-placeholder,var(--muted-foreground)))] placeholder:opacity-100" ref={input_ref} disabled={!effective_source} value={query} aria-label={translate("model.search_placeholder")} placeholder={translate("model.search_placeholder")} spellCheck={false} onChange={(event) => set_query(event.target.value)} onKeyDown={handle_key_down} />
      </InputGroup>
    </div>

    {selected_model && effective_source === saved_source && !models.some((model) => same_model(model.model, selected_model)) ? <p className="break-all p-2 text-xs text-muted-foreground">{translate("model.current")}: {selected_model?.id} · {translate("model.unavailable")}</p> : null}
    {!effective_source ? <p className="p-4 text-center text-xs text-muted-foreground">{translate(source_options.length ? "model.choose_town" : "model.empty")}</p> : filtered_models.length === 0 ? <p className="p-4 text-center text-xs text-muted-foreground">{query.trim() ? translate("model.no_match") : !full_catalog && models.length ? translate("model.browse_all") : empty_text || translate("model.empty")}</p> : <div ref={list_ref} onScroll={(event) => { scroll_positions.current[full_catalog ? "catalog" : "shortlist"] = event.currentTarget.scrollTop; }} onKeyDown={(event) => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0 || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-1", variant === "field" && "space-y-0.5 pb-0.5")} >
      {filtered_models.map((model) => {
        const active = same_model(model.model, selected_model);
        return <div key={JSON.stringify(model.model)}>
          <PreviewCard.Root>
          <PreviewCard.Trigger delay={300} closeDelay={120} render={<button type="button" aria-pressed={active} title={model.name} className={cn(model_menu_item_class_name, variant === "field" && model_field_item_class_name, active ? variant === "field" ? model_field_selected_class_name : model_menu_selected_class_name : model_menu_interaction_class_name, variant === "field" && "focus-visible:ring-2 focus-visible:ring-ring/30")} onClick={() => void on_select(model.model)} />}>
            <LLMModelIcon model_id={model.id} model_name={model.name} tags={model.tags} size_class={variant === "field" ? "size-4" : "size-3.5"} />
            <span className="min-w-0 flex-1 truncate">{model.name}</span>
            {active ? <TbCheck className="ml-auto text-primary" /> : null}
          </PreviewCard.Trigger>
          <ModelPreview model={model} />
        </PreviewCard.Root></div>;
      })}
    </div>}
    {has_shortlist ? <button type="button" disabled={!effective_source} className="shrink-0 rounded-control px-3 py-2 text-left text-xs text-muted-foreground hover:bg-interaction-hover focus-visible:bg-interaction-hover disabled:opacity-50" onClick={() => { set_browse_all(!full_catalog); set_query(""); input_ref.current?.focus(); }}>{translate(full_catalog ? "model.back_shortlist" : "model.browse_all")}</button> : null}
  </div>;
}

/** 以带标签的结构化来源键区分 Downtown 与直接客户端，允许原始 ID 包含任意前缀。 */
function model_source_key(model: ModelReference): string {
  return JSON.stringify("downtown" in model ? ["downtown", model.downtown] : ["client", model.client]);
}

/** 按名称与 model_id 做大小写不敏感的子串筛选。 */
function filter_models(models: readonly ModelSummary[], query: string): readonly ModelSummary[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [...models].sort((left, right) => left.name.localeCompare(right.name));
  return [...models].sort((left, right) => left.name.localeCompare(right.name)).filter((model) => `${model.name} ${model.id} ${model.source_name ?? ""} ${model.source_id ?? ""}`.toLowerCase().includes(keyword));
}

/** 模型条目悬停或聚焦时展示的只读详情卡。 */
function ModelPreview({ model }: ModelDetailsProps) {
  const container = use_theme_portal_container();
  return <PreviewCard.Portal container={container}>
    <PreviewCard.Positioner side="right" align="start" sideOffset={8} collisionPadding={12} className="z-[60] outline-none">
      <PreviewCard.Popup className={cn("w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden border outline-none data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 duration-150", model_preview_class_name)}>
        <ModelDetails model={model} />
      </PreviewCard.Popup>
    </PreviewCard.Positioner>
  </PreviewCard.Portal>;
}
/** 不依赖浮层的完整模型详情。 */
function ModelDetailsContent({ model }: ModelDetailsProps) {
  const translate = use_translation("chat");
  const common_translate = use_translation("common");
  const pricing = build_model_pricing([model])[0];
  const reasoning_label = format_model_reasoning(model);
  const default_effort = get_default_model_reasoning(model);
  return <div className="max-h-[min(60vh,var(--available-height,100vh))] overflow-y-auto overscroll-contain p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle"><LLMModelIcon model_id={model.id} model_name={model.name} tags={model.tags} size_class="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{model.name}</span><span className="mt-0.5 block truncate font-mono text-3xs text-muted-foreground">{model.id}</span></span>
        </div>
        {model.description ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{model.description}</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-item bg-surface-subtle p-2.5 text-2xs">
          <ModelDetail label={translate("model.context")} value={model.context_window ? format_token_count(model.context_window) : translate("model.not_provided")} />
          <ModelDetail label={translate("model.capabilities")} value={model.modalities.join(" / ") || translate("model.not_provided")} />
          <ModelDetail label={translate("model.reasoning")} value={reasoning_label || translate("model.not_supported")} />
          <ModelDetail label={translate("model.default_effort")} value={default_effort?.name || common_translate("state.automatic")} />
        </dl>
        <div className="mt-3 flex items-center gap-2 text-2xs">
          <span className="text-muted-foreground">{translate("model.price")}</span>
          <span className="ml-auto tabular-nums text-foreground">{pricing ? translate("model.price_detail", { input: format_usd_price(pricing.input_usd_per_1m), output: format_usd_price(pricing.output_usd_per_1m) }) : translate("model.not_provided")}</span>
        </div>
        {model.tags.length ? <div className="mt-3 flex flex-wrap gap-1">{model.tags.map((tag) => <span key={tag} className="rounded-chip bg-surface-subtle px-1.5 py-0.5 text-3xs text-muted-foreground">{tag}</span>)}</div> : null}
        </div>;
}
/** 可放在页面、侧栏或自定义浮层中的模型详情。 */
export function ModelDetails(props: ModelDetailsProps) {
  return <ControlMessagesProvider translate={props.translate}><ModelDetailsContent {...props} /></ControlMessagesProvider>;
}

/** 详情卡中的紧凑键值信息。 */
function ModelDetail({ label, value }: ModelDetailProps) {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate text-foreground" title={value}>{value}</dd></div>;
}

/** 推理强度列表；留白放在滚动内容内，滚动条与模型目录保持相同对齐。 */
export function ReasoningOptions({ efforts, selected_effort, on_select }: ReasoningOptionsProps) {
  return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className="p-1">{efforts.map((effort) => {
    const active = effort.id === selected_effort;
    return <button key={effort.id} type="button" aria-pressed={active} onClick={() => void on_select(effort.id)} className={cn(model_menu_item_class_name, active ? model_menu_selected_class_name : model_menu_interaction_class_name)}>
      <span className="min-w-0 flex-1 truncate">{effort.name}</span>
      {effort.description ? <span className="sr-only">{effort.description}</span> : null}
      {active ? <TbCheck className="ml-auto text-primary" /> : null}
    </button>;
  })}</div></div>;
}

/** 聊天菜单与表单共用目录、搜索和选中逻辑。 */
export function ModelOptions(props: ModelOptionsProps) {
  return <ControlMessagesProvider translate={props.translate}><ModelOptionsContent {...props} /></ControlMessagesProvider>;
}
/** 提供模型与可选推理入口，不持有宿主配置。 */
export function ChatModelSelector(props: ChatModelSelectorProps) {
  return <ControlMessagesProvider translate={props.translate}><ChatModelSelectorContent {...props} /></ControlMessagesProvider>;
}
