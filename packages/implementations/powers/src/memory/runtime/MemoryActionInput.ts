/** Memory 公共 Action 的确定性输入解析；schema 与 CLI 数值规则集中维护。 */
import { z } from "zod";
import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import type { MemoryType } from "../types/Memory.js";
import type { MemoryWriteTarget, MemorySubjectKind } from "../types/MemoryAccess.js";

export const memory_type_schema = z.enum(["fact", "preference", "decision", "episode", "procedure", "document"]);
export const memory_write_target_schema = z.enum(["current_workspace", "user", "agent"]);
export const memory_subject_kind_schema = z.enum(["agent", "user", "workspace", "city"]);

/** 解析正整数 CLI 参数。 */
export function parse_positive_integer(value: string): number {
  const text = String(value || "").trim();
  if (!/^\d+$/u.test(text)) throw new Error(`Invalid positive integer: ${value}`);
  const number_value = Number(text);
  if (!Number.isFinite(number_value) || number_value < 1) throw new Error(`Invalid positive integer: ${value}`);
  return number_value;
}
/** 解析非负整数 CLI 参数。 */
export function parse_non_negative_integer(value: string): number {
  const text = String(value || "").trim();
  if (!/^\d+$/u.test(text)) throw new Error(`Invalid non-negative integer: ${value}`);
  return Number(text);
}
/** 解析有限数值 CLI 参数。 */
export function parse_number(value: string): number {
  const number_value = Number(String(value || "").trim());
  if (!Number.isFinite(number_value)) throw new Error(`Invalid number: ${value}`);
  return number_value;
}
/** 把 Action JSON 输入归一化为普通对象。 */
export function read_body_object(raw_body: PowerJsonValue): PowerJsonObject {
  return raw_body && typeof raw_body === "object" && !Array.isArray(raw_body) ? raw_body as PowerJsonObject : {};
}
/** 读取字符串字段，非字符串返回空串。 */
export function read_string(body: PowerJsonObject, key: string): string { return typeof body[key] === "string" ? String(body[key]) : ""; }
/** 读取去掉首尾空白的可选字符串。 */
export function read_optional_string(body: PowerJsonObject, key: string): string | undefined { return read_string(body, key).trim() || undefined; }
/** 读取可选数值。 */
export function read_optional_number(body: PowerJsonObject, key: string): number | undefined { return typeof body[key] === "number" ? Number(body[key]) : undefined; }
/** 读取可选布尔值。 */
export function read_optional_boolean(body: PowerJsonObject, key: string): boolean | undefined { return typeof body[key] === "boolean" ? Boolean(body[key]) : undefined; }
/** 校验可选知识类型。 */
export function read_optional_memory_type(body: PowerJsonObject): MemoryType | undefined {
  const result = memory_type_schema.safeParse(body.memory_type);
  return result.success ? result.data : undefined;
}
/** 校验必填写入目标。 */
export function read_memory_write_target(body: PowerJsonObject): MemoryWriteTarget {
  const result = memory_write_target_schema.safeParse(body.target);
  if (!result.success) throw new Error("Memory remember requires target");
  return result.data;
}
/** 校验可选知识类型过滤集合。 */
export function read_optional_memory_type_list(body: PowerJsonObject): MemoryType[] | undefined {
  if (!Array.isArray(body.memory_types)) return undefined;
  return body.memory_types.map((value) => memory_type_schema.safeParse(value)).flatMap((result) => result.success ? [result.data] : []);
}
/** 校验可选主体过滤集合。 */
export function read_optional_subject_kind_list(body: PowerJsonObject): MemorySubjectKind[] | undefined {
  if (!Array.isArray(body.subject_kinds)) return undefined;
  return body.subject_kinds.map((value) => memory_subject_kind_schema.safeParse(value)).flatMap((result) => result.success ? [result.data] : []);
}
