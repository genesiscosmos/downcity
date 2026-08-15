/** ChatInput 使用的文本模型选择器。 */

import { useMemo } from "react";
import { ModelSelector } from "@/components/model";
import type { DesktopAgentSummary, DesktopModelSummary, DesktopSessionConfiguration } from "@common/types/DesktopApi";

/** Chat 模型选择器属性。 */
interface ChatModelSelectorProps {
  /** 当前 Agent。 */
  agent: DesktopAgentSummary;
  /** 当前 Session 配置。 */
  configuration?: DesktopSessionConfiguration;
  /** Federation 模型目录。 */
  models: DesktopModelSummary[];
  /** 目录是否正在加载。 */
  models_loading: boolean;
  /** 切换 Session 模型。 */
  set_model(model_id: string): Promise<void>;
}

/** 过滤生图模型后复用通用 Duobox 模型 Popover。 */
export function ChatModelSelector(props: ChatModelSelectorProps) {
  const current_model_id = props.configuration?.model_id || props.agent.model_id;
  const text_models = useMemo(() => props.models.filter(is_text_model), [props.models]);
  return <ModelSelector
    current_model_id={current_model_id}
    models={text_models}
    loading={props.models_loading && !current_model_id}
    on_select_model={props.set_model}
    align="start"
    side="top"
  />;
}

/** 判断模型是否支持 Agent 文本对话。 */
function is_text_model(model: DesktopModelSummary): boolean {
  return model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality.toLowerCase()));
}
