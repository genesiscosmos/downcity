/** ChatInput 使用的模型与推理强度 submenu 选择器。 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { TbCheck, TbChevronRight, TbLoader2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DesktopAgentSummary, DesktopModelSummary, DesktopSessionConfiguration } from "@common/types/DesktopApi";
import { LLMModelIcon } from "@/components/model";

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
  return <div className="space-y-0.5">{models.map((model) => <Button key={model.model_id} size="full" className="rounded-floating-item text-xs text-foreground/90 hover:bg-foreground/[0.06]" onClick={() => void on_select(model.model_id)}><LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-4" /><span className="min-w-0 flex-1 truncate text-left">{model.name}</span>{model.model_id === current_model_id ? <TbCheck className="size-3.5 shrink-0" /> : null}</Button>)}</div>;
}

function ReasoningOptions({ efforts, selected_effort, on_select }: { efforts: NonNullable<DesktopModelSummary["reasoning"]>["efforts"]; selected_effort?: string; on_select(effort?: string): Promise<void> }) {
  return <div className="space-y-0.5">{efforts.map((effort) => <Button key={effort.id} size="full" className="rounded-floating-item text-xs text-foreground/90 hover:bg-foreground/[0.06]" onClick={() => void on_select(effort.id)}><span className="min-w-0 flex-1 text-left"><span className="block truncate">{effort.name}</span>{effort.description ? <span className="block truncate text-[10px] text-muted-foreground/75">{effort.description}</span> : null}</span>{effort.id === selected_effort ? <TbCheck className="size-3.5 shrink-0" /> : null}</Button>)}</div>;
}

/** 判断模型是否支持 Agent 文本对话。 */
function is_text_model(model: DesktopModelSummary): boolean { return model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality.toLowerCase())); }
