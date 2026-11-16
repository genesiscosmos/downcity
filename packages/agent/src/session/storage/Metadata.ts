/**
 * SDK Session 元数据辅助。
 *
 * 关键点（中文）
 * - 提供标题规范化与系统时区读取，供 Session 配置和创建流程使用。
 * - 不负责数据库连接、消息聚合或附件读写。
 */

/**
 * 归一化 session 标题。
 */
export function normalize_session_title(input: unknown): string | undefined {
  const title = typeof input === "string" ? input.trim() : "";
  return title || undefined;
}

/**
 * 读取当前系统时区。
 */
export function resolve_system_timezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof timezone === "string" && timezone.trim()
    ? timezone.trim()
    : "UTC";
}
