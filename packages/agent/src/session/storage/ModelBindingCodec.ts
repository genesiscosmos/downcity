/** 模型事实读取校验：损坏记录不得回落 Agent 默认值或被解释为旧历史缺省。 */
import type { SessionModelBinding } from "../../types/store/SessionModelBinding.js";

/** 只接受可恢复的稳定模型 ID/null，排除展示 label、运行时对象与空字符串。 */
export function decode_model_binding(text: string): SessionModelBinding {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("session_model_binding_invalid: model binding must be an object");
  const binding = value as SessionModelBinding;
  if (!(binding.default_model_id === null || typeof binding.default_model_id === "string" && binding.default_model_id.trim()) ||
      !(binding.override_model_id === undefined || typeof binding.override_model_id === "string" && binding.override_model_id.trim())) throw new Error("session_model_binding_invalid: stable model IDs are required");
  return { default_model_id: binding.default_model_id, ...(binding.override_model_id ? { override_model_id: binding.override_model_id } : {}) };
}
