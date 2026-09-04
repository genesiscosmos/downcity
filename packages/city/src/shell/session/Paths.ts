/**
 * Shell service 路径工具。
 *
 * 关键点（中文）
 * - shell 运行产物统一落在 Agent private runtime directory 数据目录的 `shell/<shell_id>/`。
 * - 目录结构简单稳定，便于调试与后续恢复。
 */

import path from "node:path";

export function get_shell_root_dir(data_path: string): string {
  return path.join(data_path, "shell");
}

export function get_shell_dir(data_path: string, shell_id: string): string {
  return path.join(get_shell_root_dir(data_path), String(shell_id || "").trim());
}

export function get_shell_snapshot_path(
  data_path: string,
  shell_id: string,
): string {
  return path.join(get_shell_dir(data_path, shell_id), "snapshot.json");
}

export function get_shell_output_path(data_path: string, shell_id: string): string {
  return path.join(get_shell_dir(data_path, shell_id), "output.log");
}
