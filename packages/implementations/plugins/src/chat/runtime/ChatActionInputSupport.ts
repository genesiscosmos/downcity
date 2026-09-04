/**
 * Chat action 输入映射共享辅助。
 *
 * 关键点（中文）
 * - 只放 CLI/API 输入映射复用的轻量解析函数。
 * - 具体 action 的 payload 组装留在各 action input 模块中。
 */

import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";

/**
 * 判断 PluginJsonValue 是否为对象。
 */
export function isJsonObject(value: PluginJsonValue): value is PluginJsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 读取字符串 option。
 */
export function getStringOpt(
  opts: Record<string, PluginJsonValue>,
  key: string,
): string {
  return typeof opts[key] === "string" ? String(opts[key]).trim() : "";
}

/**
 * 读取布尔 option。
 */
export function getBooleanOpt(
  opts: Record<string, PluginJsonValue>,
  key: string,
): boolean {
  return opts[key] === true;
}

/**
 * 解析正整数 option。
 */
export function parsePositiveIntOptionOrThrow(
  value: string,
  fieldName: string,
): number {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${fieldName} is required`);
  }
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return parsed;
}

/**
 * 解析可选时间戳。
 */
export function parseOptionalTimestampOrThrow(
  value: string,
  fieldName: string,
): number | undefined {
  const text = String(value || "").trim();
  if (!text) return undefined;
  return parsePositiveIntOptionOrThrow(text, fieldName);
}

/**
 * 读取 history direction。
 */
export function readHistoryDirectionOrThrow(
  value: string,
): "all" | "inbound" | "outbound" | undefined {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  if (!text) return undefined;
  if (text === "all" || text === "inbound" || text === "outbound") {
    return text;
  }
  throw new Error(`Invalid direction: ${value}. Use all|inbound|outbound.`);
}
