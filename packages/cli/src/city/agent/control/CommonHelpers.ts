/**
 * 单 agent control API 通用 helper。
 *
 * 关键点（中文）
 * - 聚合 control 路由、query/path/文本裁剪等基础工具。
 * - 单 agent 控制面统一收敛到 `/api/control/*`。
 * - 不依赖任何业务状态。
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * 单 agent control API 的公开路由前缀。
 *
 * 说明（中文）
 * - 单 agent 控制面只暴露 `/api/control/*`。
 */
export const CONTROL_API_ROUTE_PREFIXES = ["/api/control"] as const;

/**
 * 为同一个 control 端点生成公开路径别名。
 */
export function buildControlRouteAliases(suffix: string): string[] {
  const normalizedSuffix = String(suffix || "").startsWith("/")
    ? String(suffix || "")
    : `/${String(suffix || "")}`;
  return CONTROL_API_ROUTE_PREFIXES.map((prefix) => `${prefix}${normalizedSuffix}`);
}

/**
 * 解析 limit 参数并做边界裁剪。
 */
export function toLimit(
  raw: string | undefined,
  fallback = DEFAULT_LIMIT,
): number {
  const n = Number.parseInt(String(raw || "").trim(), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

/**
 * 转成可选字符串。
 */
export function toOptionalString(input: unknown): string | undefined {
  const value = typeof input === "string" ? input.trim() : "";
  return value ? value : undefined;
}

/**
 * 安全 decodeURIComponent。
 */
export function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

/**
 * 文本截断。
 */
export function truncateText(text: string, maxChars: number): string {
  const normalized = String(text || "");
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, Math.max(0, maxChars - 3)) + "...";
}
