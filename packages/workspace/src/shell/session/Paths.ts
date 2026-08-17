/**
 * Shell service 路径工具。
 *
 * 关键点（中文）
 * - shell 运行产物统一落在 AgentWorkspace 数据目录的 `shell/<shellId>/`。
 * - 目录结构简单稳定，便于调试与后续恢复。
 */

import path from "node:path";

export function getShellRootDir(dataPath: string): string {
  return path.join(dataPath, "shell");
}

export function getShellDir(dataPath: string, shellId: string): string {
  return path.join(getShellRootDir(dataPath), String(shellId || "").trim());
}

export function getShellSnapshotPath(
  dataPath: string,
  shellId: string,
): string {
  return path.join(getShellDir(dataPath, shellId), "snapshot.json");
}

export function getShellOutputPath(dataPath: string, shellId: string): string {
  return path.join(getShellDir(dataPath, shellId), "output.log");
}
