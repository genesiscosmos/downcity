/**
 * 围栏路径规范化。
 *
 * OS 在真实文件路径上执行权限检查，策略必须解析 /var → /private/var 等符号链接。
 * 对尚不存在的目标解析最近的现存祖先，保留未创建的路径片段；其他文件错误直接抛出。
 */

import { realpathSync } from "node:fs";
import path from "node:path";

/** 返回用于 OS 策略的真实绝对路径，支持尚未创建的末端。 */
export function resolve_policy_path(target_path: string): string {
  const absolute_path = path.resolve(target_path);
  try {
    return realpathSync(absolute_path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent_path = path.dirname(absolute_path);
    if (parent_path === absolute_path) throw error;
    return path.join(resolve_policy_path(parent_path), path.basename(absolute_path));
  }
}
