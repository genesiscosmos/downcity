/**
 * City Env Paths：项目与运行目录路径规则模块。
 *
 * 关键点（中文）
 * - 统一管理单个 agent 项目内 `.downcity` 及其子目录/文件路径规则。
 * - 避免路径字符串在不同模块重复拼接，降低维护成本。
 * - 这里描述的是“项目级路径约定”，与 `process/registry/CityPaths.ts` 的全局路径约定分开。
 */
import path from "path";

export function getDowncityDirPath(cwd: string): string {
  return path.join(cwd, ".downcity");
}

/**
 * 日志目录路径。
 */
export function getLogsDirPath(cwd: string): string {
  return path.join(getDowncityDirPath(cwd), "logs");
}

export function getCacheDirPath(cwd: string): string {
  return path.join(getDowncityDirPath(cwd), ".cache");
}

/**
 * 任务运行目录路径。
 */
export function getDowncityTasksDirPath(cwd: string): string {
  return path.join(getDowncityDirPath(cwd), "task");
}

export function getDowncityDebugDirPath(cwd: string): string {
  return path.join(getDowncityDirPath(cwd), ".debug");
}

/**
 * `.downcity/public` 公开资源目录路径。
 */
export function getDowncityPublicDirPath(cwd: string): string {
  return path.join(getDowncityDirPath(cwd), "public");
}
