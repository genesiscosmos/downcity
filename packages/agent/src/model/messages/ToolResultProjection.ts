/**
 * 工具结果到模型 JSON 的共享投影。
 * 工具返回的二进制属于载荷，不能作为普通文本进入历史或累计摘要；这里递归替换明确的
 * base64/data URL 为元信息，保留同级文字、文件路径与 URL，且不修改持久化原始结果。
 */
import type { ModelJsonValue } from "@downcity/type";

/** 保留工具 JSON 语义，替换嵌套的明确二进制载荷。 */
export function project_tool_result(value: unknown): ModelJsonValue {
  const json = JSON.parse(JSON.stringify(value ?? null)) as ModelJsonValue;
  return project_value(json);
}

/** 递归处理数组和对象；仅匹配完整 data URL 或明确命名的 base64 字段。 */
function project_value(value: ModelJsonValue): ModelJsonValue {
  if (typeof value === "string") {
    const match = /^data:([^;,]*)(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(value);
    return match ? binary_reference(match[2]!, match[1] || "application/octet-stream") : value;
  }
  if (Array.isArray(value)) return value.map(project_value);
  if (!value || typeof value !== "object") return value;
  const media_type = typeof value.media_type === "string" ? value.media_type
    : typeof value.mime_type === "string" ? value.mime_type : "application/octet-stream";
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const explicit_base64 = /^(?:base64|.*_base64)$/i.test(key)
      || (key === "data" && value.type === "base64");
    return [key, explicit_base64 && typeof item === "string" && is_base64(item)
      ? binary_reference(item, media_type) : project_value(item)];
  }));
}

/** 校验明确 base64 字段，避免误改普通文本字段。 */
function is_base64(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9+/=_\-\s]+$/.test(value);
}

/** 元信息只表达载荷本身；可用文件路径、URL 继续保留在原对象中，不伪造引用。 */
function binary_reference(encoded: string, media_type: string): ModelJsonValue {
  const compact = encoded.replace(/\s/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return {
    type: "binary_metadata",
    media_type,
    encoding: "base64",
    encoded_characters: compact.length,
    estimated_bytes: Math.max(0, Math.floor(compact.length * 3 / 4) - padding),
  };
}
