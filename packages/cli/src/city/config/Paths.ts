/**
 * City AgentWorkspace 数据路径规则模块。
 *
 * 关键点（中文）
 * - 统一管理 AgentWorkspace 私有数据根及其子目录路径规则。
 * - 避免路径字符串在不同模块重复拼接，降低维护成本。
 * - 调用方必须传入 `AgentWorkspace.data_path`，不能传入项目目录。
 */
import path from "path";

export function getDowncityDirPath(data_path: string): string {
  return path.resolve(data_path);
}

/**
 * 日志目录路径。
 */
export function getLogsDirPath(data_path: string): string {
  return path.join(getDowncityDirPath(data_path), "logs");
}

export function getCacheDirPath(data_path: string): string {
  return path.join(getDowncityDirPath(data_path), ".cache");
}

/**
 * 任务运行目录路径。
 */
export function getDowncityTasksDirPath(data_path: string): string {
  return path.join(getDowncityDirPath(data_path), "task");
}

/**
 * AgentWorkspace 私有公开资源目录路径。
 */
export function getDowncityPublicDirPath(data_path: string): string {
  return path.join(getDowncityDirPath(data_path), "public");
}
