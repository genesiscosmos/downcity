"use client";
/** 聊天与 Agent 创建共用的模型菜单；仅在场景提供保存能力时展示推理强度。 */

import { PreviewCard } from "@base-ui/react/preview-card";
import { use_theme_portal_container } from "../theme-container";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { TbCheck, TbChevronRight, TbLoader2, TbSearch } from "react-icons/tb";
import { Input } from "../input";

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

const menu_item_base_class_name = "relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs outline-none [&>svg]:size-3.5 [&>svg]:shrink-0";
const menu_item_highlighted_class_name = "bg-interaction-selected text-foreground";
const menu_item_interaction_class_name = "hover:bg-interaction-hover focus-visible:bg-interaction-hover";

/** 以一个主 dropdown 承载两个可进入的 submenu。 */
function ChatModelSelectorContent(props: ChatModelSelectorProps) {
  const translate = use_translation("chat");
  const common_translate = use_translation("common");
  const current_model_id = props.configuration.model_id;
  const text_models = useMemo(() => props.models.filter(is_text_model), [props.models]);
  const current_model = text_models.find((model) => model.model_id === current_model_id);
  const selected_effort = props.set_reasoning_effort ? current_model?.reasoning?.efforts.find((effort) => effort.id === props.configuration.reasoning_effort) : undefined;
  const trigger_label = props.models_loading && !current_model_id ? translate("model.loading") : current_model?.name || current_model_id || translate("model.select");
  const trigger_accessible_label = selected_effort?.name ? `${trigger_label}, ${translate("model.reasoning")}: ${selected_effort.name}` : trigger_label;

  const [open, set_open] = useState(false);

  return <Popover open={open} onOpenChange={set_open}>
    <PopoverTrigger render={<Button variant="ghost" size="xs" data-popup-open={open || undefined} className="max-w-64 flex-none justify-start gap-1 whitespace-nowrap rounded-full" title={trigger_accessible_label} aria-label={trigger_accessible_label} disabled={props.models_loading && !current_model_id}>{props.models_loading && !current_model_id ? <TbLoader2 className="size-4 animate-spin" /> : <LLMModelIcon model_id={current_model?.model_id || current_model_id} model_name={current_model?.name} tags={current_model?.tags} size_class="size-4" />}<span className="min-w-0 flex-1 truncate">{trigger_label}</span>{selected_effort?.name ? <span className="max-w-20 shrink-0 truncate rounded-full bg-surface-emphasis px-1.5 py-0.5 text-3xs font-medium leading-none text-muted-foreground">{selected_effort.name}</span> : null}</Button>} />
    <PopoverContent side="top" align="start" sideOffset={4} className="w-64 max-w-[calc(100vw-1rem)] p-1">
      <SelectorSubmenu label={translate("model.model")} value={current_model?.name || current_model_id || translate("model.select")}>
        <ModelOptions models={text_models} current_model_id={current_model_id} loading={props.models_loading} on_select={props.set_model} />
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
    <PopoverContent side="right" align="start" sideOffset={4} className="flex max-h-[min(80vh,var(--available-height,100vh))] w-72 max-w-[calc(100vw-1rem)] flex-col [&>div]:p-0">
      {children}
    </PopoverContent>
  </Popover>;
}

/** 带顶部搜索的模型目录列表。 */
function ModelOptionsContent({ models, current_model_id, loading, on_select, empty_text }: ModelOptionsProps) {
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
    <div className="shrink-0 p-1">
      <div className="flex w-full items-center gap-2 px-2">
        <TbSearch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input ref={input_ref} value={query} aria-label={translate("model.search_placeholder")} placeholder={translate("model.search_placeholder")} spellCheck={false} onChange={(event) => set_query(event.target.value)} onKeyDown={handle_key_down} />
      </div>
    </div>
    <div className="h-px shrink-0 bg-divider" />
    {filtered_models.length === 0 ? <p className="p-4 text-center text-xs text-muted-foreground">{query.trim() ? translate("model.no_match") : empty_text || translate("model.empty")}</p> : <div ref={list_ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
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
function filter_models(models: readonly ModelSummary[], query: string): readonly ModelSummary[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [...models].sort((left, right) => left.name.localeCompare(right.name));
  return [...models].sort((left, right) => left.name.localeCompare(right.name)).filter((model) => `${model.name} ${model.model_id}`.toLowerCase().includes(keyword));
}

/** 模型条目悬停或聚焦时展示的只读详情卡。 */
function ModelPreview({ model }: ModelDetailsProps) {
  const container = use_theme_portal_container();
  return <PreviewCard.Portal container={container}>
    <PreviewCard.Positioner side="right" align="start" sideOffset={8} collisionPadding={12} className="z-[60] outline-none">
      <PreviewCard.Popup className="w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-divider bg-popover text-popover-foreground outline-none data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 duration-150">
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
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle"><LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{model.name}</span><span className="mt-0.5 block truncate font-mono text-3xs text-muted-foreground">{model.model_id}</span></span>
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
    return <button key={effort.id} type="button" aria-pressed={active} onClick={() => void on_select(effort.id)} className={cn(menu_item_base_class_name, active ? menu_item_highlighted_class_name : menu_item_interaction_class_name)}>
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
