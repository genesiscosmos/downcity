/**
 * Accounts 服务通用工具。
 *
 * 关键说明（中文）
 * - 只放无状态纯工具，避免主服务模块继续膨胀。
 * - 工具函数不依赖 AccountsService 实例，便于后续复用和单独测试。
 */

/**
 * 生成带前缀的稳定 ID。
 */
export function prefixedId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * 生成 URL-safe token。
 */
export function randomToken(size: number): string {
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 归一化布尔值到 SQLite 整数。
 */
export function normalizeBool(value: unknown): number {
  return value ? 1 : 0;
}

/**
 * 读取错误消息。
 */
export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 将未知输入收敛为普通对象。
 */
export function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
