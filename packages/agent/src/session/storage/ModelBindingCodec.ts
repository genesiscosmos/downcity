/** 模型事实读取校验：损坏记录不得回落默认模型或解释为历史缺省。 */
import { is_model_reference } from "@downcity/type";
import type { SessionModelBinding } from "../../types/store/SessionModelBinding.js";

/** 只接受来源明确的模型引用，不接受旧编码字符串或运行时对象。 */
export function decode_model_binding(text: string): SessionModelBinding {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("session_model_binding_invalid: model binding must be an object");
  const binding = value as SessionModelBinding;
  if (binding.model === undefined) return {};
  if (!is_model_reference(binding.model)) throw new Error("session_model_binding_invalid: structured model reference required");
  return { model: { ...binding.model } };
}
