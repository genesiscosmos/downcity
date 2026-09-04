/** ChatInput 使用的模型与推理强度 submenu 选择器。 */

import { PreviewCard } from "@base-ui/react/preview-card";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { TbCheck, TbChevronRight, TbLoader2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DesktopAgentSummary, DesktopModelSummary, DesktopSessionConfiguration } from "@common/types/DesktopApi";
import { LLMModelIcon } from "@/components/model";
import { build_model_pricing } from "@/lib/model/model_pricing";
import { format_model_reasoning, get_default_model_reasoning } from "@/lib/model/model_reasoning";

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
  const current_model_id = props.configuration?.model_id || props.agent.model_id;
  const text_models = useMemo(() => props.models.filter(is_text_model), [props.models]);
  const current_model = text_models.find((model) => model.model_id === current_model_id);
  const selected_effort = current_model?.reasoning?.efforts.find((effort) => effort.id === props.configuration?.reasoning_effort);
  const trigger_label = props.models_loading && !current_model_id ? "加载中" : current_model?.name || current_model_id || "未配置";

  return <Popover>
    <PopoverTrigger asChild><Button className="min-w-0 max-w-48 justify-start rounded-full" title={trigger_label} aria-label={trigger_label} disabled={props.models_loading && !current_model_id}>{props.models_loading && !current_model_id ? <TbLoader2 className="size-4 animate-spin" /> : <LLMModelIcon model_id={current_model?.model_id || current_model_id} model_name={current_model?.name} tags={current_model?.tags} size_class="size-4" />}<span className="min-w-0 truncate">{trigger_label}</span></Button></PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={4} className="w-64 max-w-[calc(100vw-1rem)] p-1">
      <SelectorSubmenu label="模型" value={current_model?.name || current_model_id || "未配置"}>
        <ModelOptions models={text_models} current_model_id={current_model_id} loading={props.models_loading} on_select={props.set_model} />
      </SelectorSubmenu>
      {current_model?.reasoning?.efforts.length ? <SelectorSubmenu label="推理强度" value={selected_effort?.name || "自动"}>
        <ReasoningOptions efforts={current_model.reasoning.efforts} selected_effort={props.configuration?.reasoning_effort} on_select={props.set_reasoning_effort} />
      </SelectorSubmenu> : null}
    </PopoverContent>
  </Popover>;
}

/** 主菜单中的 submenu 入口。 */
function SelectorSubmenu({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const [open, set_open] = useState(false);
  return <Popover open={open} onOpenChange={set_open}>
    <PopoverTrigger asChild><button type="button" className={cn("flex min-h-10 w-full items-center gap-2 rounded-floating-item px-2.5 text-left transition-colors hover:bg-interaction-hover", open && "bg-interaction-selected")}><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-foreground/90">{label}</span><span className="block truncate text-[10px] text-muted-foreground/75">{value}</span></span><TbChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" /></button></PopoverTrigger>
    <PopoverContent side="right" align="start" sideOffset={4} className="w-72 max-w-[calc(100vw-1rem)] p-1">{children}</PopoverContent>
  </Popover>;
}

function ModelOptions({ models, current_model_id, loading, on_select }: { models: DesktopModelSummary[]; current_model_id: string; loading: boolean; on_select(model_id: string): Promise<void> }) {
  if (loading && models.length === 0) return <div className="flex min-h-12 items-center justify-center text-xs text-muted-foreground"><TbLoader2 className="mr-2 size-4 animate-spin" />加载中</div>;
  if (models.length === 0) return <div className="px-2 py-4 text-center text-xs text-muted-foreground">暂无可用模型</div>;
  return <div className="space-y-0.5">{models.map((model) => {
    const active = model.model_id === current_model_id;
    return <PreviewCard.Root key={model.model_id}>
      <PreviewCard.Trigger delay={300} closeDelay={120} render={<Button size="full" aria-pressed={active} className={cn("rounded-floating-item text-xs text-foreground/90 hover:bg-foreground/[0.06]", active && "bg-interaction-selected hover:bg-interaction-active")} onClick={() => void on_select(model.model_id)} />}>
        <LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-4" />
        <span className="min-w-0 flex-1 truncate text-left">{model.name}</span>
        {active ? <TbCheck className="size-3.5 shrink-0" /> : null}
      </PreviewCard.Trigger>
      <ModelPreview model={model} />
    </PreviewCard.Root>;
  })}</div>;
}

/** 模型条目悬停或聚焦时展示的只读详情卡。 */
function ModelPreview({ model }: { /** 当前模型目录信息。 */ model: DesktopModelSummary }) {
  const pricing = build_model_pricing([model])[0];
  const reasoning_label = format_model_reasoning(model);
  const default_effort = get_default_model_reasoning(model);
  return <PreviewCard.Portal>
    <PreviewCard.Positioner side="right" align="start" sideOffset={8} collisionPadding={12} className="z-[60] outline-none">
      <PreviewCard.Popup className="w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-background p-3 text-foreground outline-none data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 data-[side=right]:slide-in-from-left-1 duration-150">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle"><LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{model.name}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{model.model_id}</span></span>
        </div>
        {model.description ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{model.description}</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-surface-subtle p-2.5 text-[11px]">
          <ModelDetail label="上下文" value={model.context_window ? format_context_window(model.context_window) : "未提供"} />
          <ModelDetail label="能力" value={model.modalities.join(" / ") || "未提供"} />
          <ModelDetail label="推理强度" value={reasoning_label ? reasoning_label.replace(/^推理：/, "") : "不支持配置"} />
          <ModelDetail label="默认档位" value={default_effort?.name || "自动"} />
        </dl>
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">价格 · USD / 1M tokens</span>
          <span className="ml-auto tabular-nums text-foreground/85">{pricing ? `输入 $${format_usd(pricing.input_usd_per_1m)} · 输出 $${format_usd(pricing.output_usd_per_1m)}` : "未提供"}</span>
        </div>
        {model.tags.length ? <div className="mt-3 flex flex-wrap gap-1">{model.tags.map((tag) => <span key={tag} className="rounded-md bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>)}</div> : null}
      </PreviewCard.Popup>
    </PreviewCard.Positioner>
  </PreviewCard.Portal>;
}

/** 详情卡中的紧凑键值信息。 */
function ModelDetail({ label, value }: { /** 字段名称。 */ label: string; /** 字段值。 */ value: string }) {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate text-foreground/85" title={value}>{value}</dd></div>;
}

/** 将上下文 token 数转换为紧凑可读文本。 */
function format_context_window(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M tokens`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K tokens`;
  return `${value} tokens`;
}

/** 将美元价格限制为最多三位有效数字。 */
function format_usd(value: number): string { return value.toLocaleString(undefined, { maximumSignificantDigits: 3 }); }

function ReasoningOptions({ efforts, selected_effort, on_select }: { efforts: NonNullable<DesktopModelSummary["reasoning"]>["efforts"]; selected_effort?: string; on_select(effort?: string): Promise<void> }) {
  return <div className="space-y-0.5">{efforts.map((effort) => <Button key={effort.id} size="full" className="rounded-floating-item text-xs text-foreground/90 hover:bg-foreground/[0.06]" onClick={() => void on_select(effort.id)}><span className="min-w-0 flex-1 text-left"><span className="block truncate">{effort.name}</span>{effort.description ? <span className="block truncate text-[10px] text-muted-foreground/75">{effort.description}</span> : null}</span>{effort.id === selected_effort ? <TbCheck className="size-3.5 shrink-0" /> : null}</Button>)}</div>;
}

/** 判断模型是否支持 Agent 文本对话。 */
function is_text_model(model: DesktopModelSummary): boolean { return model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality.toLowerCase())); }
