import { same_model } from "@downcity/type";
"use client";
/** 表单模型与可选推理选择器，复用聊天菜单的目录、子菜单与档位列表；宿主持有并保存选择。 */
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "../button";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { cn } from "../../lib/utils";
import { ControlMessagesProvider, use_control_translation } from "../../lib/control-messages";
import type { ModelSelectorProps } from "../../types/model-controls";
import { LLMModelIcon } from "./LLMModelIcon";
import { ModelOptions, ReasoningOptions, SelectorSubmenu } from "./ChatModelSelector";
import { model_field_surface_class_name, model_field_trigger_variants, model_popover_class_name } from "./model-control-styles";

/** 浮层只持有开合状态，当前选择由宿主提供。 */
function ModelSelectorContent({ selected_model, reasoning_effort, models, loading = false, empty_text, trigger_label, on_select_model,
  on_select_reasoning_effort, align = "start", side = "bottom", class_name, control_size = "compact", favorite_models, recent_models }: ModelSelectorProps) {
  const translate = use_control_translation("chat");
  const common_translate = use_control_translation("common");
  const [open, set_open] = useState(false);
  const current_model = models.find((model) => same_model(model.model, selected_model));
  const label = loading ? common_translate("state.loading") : current_model?.name || selected_model?.id || trigger_label || common_translate("state.not_configured");
  const reasoning_efforts = on_select_reasoning_effort ? current_model?.reasoning?.efforts : undefined;
  const selected_effort = reasoning_efforts?.find((effort) => effort.id === reasoning_effort);
  const accessible_label = selected_effort ? `${label}, ${translate("model.reasoning")}: ${selected_effort.name}` : label;
  const model_options = <ModelOptions variant="field" favorite_models={favorite_models} recent_models={recent_models} selected_model={selected_model} models={models} loading={loading} empty_text={empty_text || translate("model.empty")} on_select={(model_id) => {
    set_open(false);
    return on_select_model(model_id);
  }} />;

  return <Popover open={open} onOpenChange={set_open}>
    <PopoverTrigger render={<Button variant="ghost" size="default" data-popup-open={open || undefined} className={cn(model_field_surface_class_name, model_field_trigger_variants({ control_size }), "max-w-48 flex-none justify-start whitespace-nowrap", class_name)}
      title={accessible_label} aria-label={accessible_label} disabled={loading && !selected_model}>
      {loading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <LLMModelIcon model_id={selected_model?.id ?? ""} model_name={current_model?.name} tags={current_model?.tags} size_class="size-4" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected_effort ? <span className="max-w-20 shrink-0 truncate rounded-full bg-surface-emphasis px-1.5 py-0.5 text-3xs font-medium leading-none text-muted-foreground">{selected_effort.name}</span> : null}
    </Button>} />
    <PopoverContent align={align} side={side} className={cn(model_popover_class_name, "flex max-h-[min(80vh,var(--available-height,100vh))] w-80 max-w-[calc(100vw-1rem)] flex-col", reasoning_efforts?.length && "p-1")}>
      {reasoning_efforts?.length ? <>
        <SelectorSubmenu label={translate("model.model")} value={current_model?.name || selected_model?.id || translate("model.select")}>
          {model_options}
        </SelectorSubmenu>
        <SelectorSubmenu label={translate("model.reasoning")} value={selected_effort?.name || common_translate("state.automatic")}>
          <ReasoningOptions efforts={reasoning_efforts} selected_effort={reasoning_effort} on_select={async (effort) => {
            set_open(false);
            await on_select_reasoning_effort?.(effort);
          }} />
        </SelectorSubmenu>
      </> : model_options}
    </PopoverContent>
  </Popover>;
}
/** 独用表单入口，接收目录、文案和保存回调。 */
export function ModelSelector(props: ModelSelectorProps) {
  return <ControlMessagesProvider translate={props.translate}><ModelSelectorContent {...props} /></ControlMessagesProvider>;
}
