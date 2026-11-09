/**
 * 模型与历史工具共用的 JSON 字节预算。
 * 小值保持原样；大值以合法 JSON 预览、明确的字段/数组省略标记及源定位返回。
 * 预算针对 UTF-8 序列化结果，始终不修改原始对象，也不截断 JSON 文本。
 */
import type { ModelJsonValue } from "@downcity/type";

/** 单个模型工具结果的 UTF-8 JSON 上限。 */
export const TOOL_RESULT_MAX_BYTES = 32 * 1024;
/** Session Power 单次返回数据的 UTF-8 JSON 上限。 */
export const HISTORY_PAGE_MAX_BYTES = 64 * 1024;

/** canonical 原文定位；分类由调用者的 Session 阅读上下文补充。 */
export interface HistorySource {
  /** 原始结果所在的 Session。 */
  session_id: string;
  /** canonical 消息稳定标识。 */
  message_id: string;
  /** canonical 消息不可变顺序。 */
  message_sequence: number;
  /** 原始字段所在 Part 标识。 */
  part_id: string;
  /** 分段读取时应选择的顶层字段。 */
  field?: string;
}

/** 统计真实 JSON 字节数，供所有投影入口统一使用。 */
export function json_bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** 用递减预览预算保证整个信封（含省略标记与源引用）落在预算内。 */
export function bound_json(value: ModelJsonValue, max_bytes = TOOL_RESULT_MAX_BYTES, source?: HistorySource): ModelJsonValue {
  const original_bytes = json_bytes(value);
  if (original_bytes <= max_bytes) return value;
  for (let allowance = Math.floor(max_bytes / 2); allowance >= 64; allowance = Math.floor(allowance / 2)) {
    const preview = preview_value(value, allowance, 0);
    const result: ModelJsonValue = {
      view: "bounded_preview", truncated: true, original_bytes,
      ...(source ? { source: { ...source }, read_action: "session.part" } : {}),
      preview,
    };
    if (json_bytes(result) <= max_bytes) return result;
  }
  throw new Error("JSON preview metadata exceeds the byte budget");
}

/** 递归保留业务状态和前缀；每层都有尺寸、广度与深度上限。 */
function preview_value(value: ModelJsonValue, budget: number, depth: number): ModelJsonValue {
  if (json_bytes(value) <= budget) return value;
  if (typeof value === "string") {
    // 字符偏移遵循 JavaScript UTF-16；以 code point 取前缀，避免拆开 emoji。
    let end = Math.min(value.length, Math.floor(budget / 6));
    if (end > 0 && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--;
    return { view: "text_preview", text: Buffer.from(value.slice(0, end), "utf16le").toString("utf16le"), original_characters: value.length, omitted_range: [end, value.length] };
  }
  if (!value || typeof value !== "object") return value;
  if (depth >= 12 || budget < 256) return { view: "omitted", original_bytes: json_bytes(value) };
  if (Array.isArray(value)) {
    const count = Math.min(value.length, 8, Math.max(1, Math.floor(budget / 512)));
    return { view: "array_preview", original_length: value.length,
      items: value.slice(0, count).map(item => preview_value(item, Math.floor(budget / (count + 1)), depth + 1)),
      omitted_range: [count, value.length] };
  }
  const entries = Object.entries(value).filter(([key]) => key.length <= 128)
    .sort(([left], [right]) => priority(right) - priority(left));
  const count = Math.min(entries.length, 24, Math.max(1, Math.floor(budget / 256)));
  const selected = entries.slice(0, count);
  return { view: "object_preview", fields: Object.fromEntries(selected.map(([key, item]) =>
    [key, preview_value(item, Math.floor(budget / (count + 1)), depth + 1)])),
    original_field_count: Object.keys(value).length,
    omitted_field_count: Object.keys(value).length - count };
}

/** 成功标志与错误分类优先于大正文。 */
function priority(key: string): number {
  return /^(?:success|status|state|code|error_code|type|error|session_id|message_id|part_id)$/.test(key) ? 1 : 0;
}
