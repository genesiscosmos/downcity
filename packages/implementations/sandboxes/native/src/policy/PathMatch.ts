/**
 * 路径匹配辅助。
 *
 * 关键点（中文）
 * - 只做词法判定，不访问文件系统，因此路径不存在不改变结论。
 * - 与 City 侧文件工具的边界规则保持同一语义，避免两边漂移。
 */

import path from "node:path";

/** 判断目标路径是否等于根路径或位于其下。 */
export function is_path_inside_root(root_path: string, target_path: string): boolean {
  const relative_path = path.relative(root_path, target_path);
  return (
    relative_path === ""
    || (
      relative_path !== ".."
      && !relative_path.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative_path)
    )
  );
}
