/**
 * Skill 运行时通用工具。
 *
 * 关键点（中文）
 * - 只提供纯函数，不读取任何全局状态。
 */

/**
 * 展开 `~` 路径。
 *
 * 关键点（中文）：home 目录由调用方传入，便于测试与沙箱环境替换真实用户目录。
 */
export function expand_home(value: string, home_path: string): string {
  const raw = String(value || "");
  const home = String(home_path || "").trim();
  if (!home) return raw;
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return `${home}${raw.slice(1)}`;
  return raw;
}
