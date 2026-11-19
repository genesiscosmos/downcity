"use client";
/** 表单模型选择器，复用聊天菜单的目录、搜索、详情与选中行为。 */
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "../button";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { cn } from "../../lib/utils";
import { ControlMessagesProvider, use_control_translation } from "../../lib/control-messages";
import type { ModelSelectorProps } from "../../types/model-controls";
import { LLMModelIcon } from "./LLMModelIcon";
import { ModelOptions } from "./ChatModelSelector";
import { model_field_surface_class_name, model_field_trigger_variants, model_popover_class_name } from "./model-control-styles";

/** 浮层只持有开合状态，当前选择由宿主提供。 */
function ModelSelectorContent({ current_model_id, models, loading = false, empty_text, trigger_label, on_select_model,
  align = "start", side = "bottom", class_name, control_size = "compact" }: ModelSelectorProps) {
  const translate = use_control_translation("chat");
  const common_translate = use_control_translation("common");
  const [open, set_open] = useState(false);
  const current_model = models.find((model) => model.model_id === current_model_id);
  const label = loading ? common_translate("state.loading") : current_model?.name || current_model_id || trigger_label || common_translate("state.not_configured");
  return <Popover open={open} onOpenChange={set_open}>
    <PopoverTrigger render={<Button variant="ghost" size="default" data-popup-open={open || undefined} className={cn(model_field_surface_class_name, model_field_trigger_variants({ control_size }), "max-w-48 flex-none justify-start whitespace-nowrap", class_name)}
      title={label} aria-label={label} disabled={loading && !current_model_id}>
      {loading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <LLMModelIcon model_id={current_model_id} model_name={current_model?.name} tags={current_model?.tags} size_class="size-4" />}
      <span className="min-w-0 truncate">{label}</span>
    </Button>} />
    <PopoverContent align={align} side={side} className={cn(model_popover_class_name, "flex max-h-[min(80vh,var(--available-height,100vh))] w-80 max-w-[calc(100vw-1rem)] flex-col")}>
      <ModelOptions variant="field" current_model_id={current_model_id} models={models} loading={loading} empty_text={empty_text || translate("model.empty")} on_select={(model_id) => {
        set_open(false);
        return on_select_model(model_id);
      }} />
    </PopoverContent>
  </Popover>;
}
/** 独用表单入口，接收目录、文案和保存回调。 */
export function ModelSelector(props: ModelSelectorProps) {
  return <ControlMessagesProvider translate={props.translate}><ModelSelectorContent {...props} /></ControlMessagesProvider>;
}
