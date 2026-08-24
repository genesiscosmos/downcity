/** Desktop 通用模型选择器，对齐 Duobox 的模型 Popover。 */

import { useMemo, useState } from "react";
import { TbLoader2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DesktopModelSummary } from "@common/types/DesktopApi";
import { LLMModelIcon } from "./LLMModelIcon";

/** 模型选择器属性。 */
interface ModelSelectorProps {
  /** 当前选中的模型标识。 */
  current_model_id: string;
  /** 可选模型目录。 */
  models: DesktopModelSummary[];
  /** 模型目录是否仍在加载。 */
  loading?: boolean;
  /** 无模型时展示的文本。 */
  empty_text?: string;
  /** 未配置模型时的触发器文本。 */
  trigger_label?: string;
  /** 选择模型后的回调。 */
  on_select_model(model_id: string): void | Promise<void>;
  /** 浮层对齐方向。 */
  align?: "start" | "center" | "end";
  /** 浮层优先展开方向。 */
  side?: "top" | "right" | "bottom" | "left";
  /** 触发按钮附加样式。 */
  class_name?: string;
}

/** 以 Duobox 的圆形触发器和 80 宽 Popover 展示模型目录。 */
export function ModelSelector({
  current_model_id,
  models,
  loading = false,
  empty_text = "暂无可用模型",
  trigger_label = "未配置",
  on_select_model,
  align = "start",
  side = "bottom",
  class_name,
}: ModelSelectorProps) {
  const [open, set_open] = useState(false);
  const sorted_models = useMemo(() => [...models].sort((left, right) => left.name.localeCompare(right.name)), [models]);
  const current_model = sorted_models.find((model) => model.model_id === current_model_id);
  const display_label = loading ? "加载中" : current_model?.name || current_model_id || trigger_label;

  const select_model = (model_id: string) => {
    set_open(false);
    void on_select_model(model_id);
  };

  return (
    <Popover open={open} onOpenChange={set_open}>
      <PopoverTrigger asChild>
        <Button
          className={cn("min-w-0 max-w-48 justify-start rounded-full", class_name)}
          title={display_label}
          aria-label={display_label}
          disabled={loading && !current_model_id}
        >
          {loading ? <TbLoader2 className="size-4 animate-spin" /> : <LLMModelIcon model_id={current_model?.model_id || current_model_id} model_name={current_model?.name} tags={current_model?.tags} size_class="size-4" />}
          <span className="min-w-0 truncate">{display_label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className="max-h-[80vh] w-80 max-w-[calc(100vw-1rem)] [&>div]:p-0">
        <div className="flex max-h-[80vh] flex-col">
          <div className="flex-1 overflow-auto px-1 pb-0.5 pt-1">
            {sorted_models.length === 0 ? <div className="py-4 text-center text-xs text-muted-foreground">{empty_text}</div> : <div className="space-y-0.5">
              {sorted_models.map((model) => {
                const active = model.model_id === current_model_id;
                return <Button key={model.model_id} size="full" className={cn("rounded-floating-item text-foreground/90 hover:bg-foreground/[0.06]", active && "bg-foreground/10 text-foreground hover:bg-foreground/10")} onClick={() => select_model(model.model_id)}>
                  <LLMModelIcon model_id={model.model_id} model_name={model.name} tags={model.tags} size_class="size-4" />
                  <span className="min-w-0 flex-1 truncate text-left" title={model.name}>{model.name}</span>
                </Button>;
              })}
            </div>}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
