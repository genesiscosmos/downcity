/** Memory 后台模型来源校验；历史缺失必须显式配置，不能用运行时账号回填。 */
import { is_model_reference } from "@downcity/type";
import type { MemoryModelBinding } from "../types/MemoryModelBinding.js";

/** 精确读取模型与非秘密授权对，保留原始字符串。 */
export function require_memory_model(binding: Partial<MemoryModelBinding> | undefined): MemoryModelBinding {
  if (!is_model_reference(binding?.model)
    || typeof binding.binding_id !== "string" || !binding.binding_id.trim()) {
    throw Object.assign(new Error("Memory Job requires configuration: explicitly select a model and durable authorization binding"), { code: "memory_model_configuration_required" });
  }
  return { model: binding.model, binding_id: binding.binding_id };
}
