/** 冻结 v12 模型绑定格式，仅供离线历史校验；当前 SDK 不承载 Session 模型覆盖策略。 */

/** 只接受稳定模型标识，不从展示名称或损坏记录推断配置。 */
export function decode_model_binding(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("session_model_binding_invalid");
  if (!(value.default_model_id === null || typeof value.default_model_id === "string" && value.default_model_id.trim())
    || !(value.override_model_id === undefined || typeof value.override_model_id === "string" && value.override_model_id.trim())) {
    throw new Error("session_model_binding_invalid");
  }
  return { default_model_id: value.default_model_id, ...(value.override_model_id ? { override_model_id: value.override_model_id } : {}) };
}
