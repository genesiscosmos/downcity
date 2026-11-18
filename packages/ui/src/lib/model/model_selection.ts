/** 模型能力筛选，不包含宿主草稿配置策略。 */
import type { ModelSummary } from "../../types/model-controls";
/** 聊天目录与宿主可共用同一文字能力判定。 */
export function is_text_model(model: Pick<ModelSummary, "modalities">): boolean {
  return model.modalities.some((modality) => ["text", "stream", "openai"].includes(modality.toLowerCase()));
}
