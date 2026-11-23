/** 模型事实读取校验：损坏记录不得回落 Agent 默认值或被解释为旧历史缺省。 */
import type { SessionModelBinding } from "../../types/store/SessionModelBinding.js";

/** 只接受完整的结构化模型引用，排除展示 label、运行时对象与空字符串。 */
export function decode_model_binding(text: string): SessionModelBinding {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("session_model_binding_invalid: model binding must be an object");
  const binding = value as SessionModelBinding;
  if (binding.model === undefined) return {};
  if (!binding.model || typeof binding.model !== "object" || Array.isArray(binding.model)
    || typeof binding.model.downtown !== "string" || !binding.model.downtown.trim()
    || typeof binding.model.id !== "string" || !binding.model.id.trim()) {
    throw new Error("session_model_binding_invalid: model must contain downtown and id");
  }
  return { model: { downtown: binding.model.downtown.trim(), id: binding.model.id.trim() } };
}
