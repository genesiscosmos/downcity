/** CLI Workspace 配置适配层。 */

import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import type { LocalWorkspaceConfig } from "@downcity/local";

export type WorkspaceRegistryRecord = LocalWorkspaceConfig;

/** 创建 Workspace 输入。 */
export interface CreateWorkspaceRegistryInput {
  /** 可选稳定 ID。 */
  workspace_id?: string;
  /** Workspace 本地路径。 */
  workspace_path: string;
  /** 可选展示名称。 */
  name?: string;
}

/** 创建或读取同一路径 Workspace。 */
export function create_workspace(input: CreateWorkspaceRegistryInput): WorkspaceRegistryRecord {
  return with_cli_local_data((data) => data.workspaces.ensure(input));
}

/** 按 ID 读取 Workspace。 */
export function get_workspace(workspace_id: string): WorkspaceRegistryRecord | null {
  return with_cli_local_data((data) => data.workspaces.get(workspace_id));
}

/** 按路径读取 Workspace。 */
export function get_workspace_by_path(workspace_path: string): WorkspaceRegistryRecord | null {
  return with_cli_local_data((data) => data.workspaces.get_by_path(workspace_path));
}

/** 列出全部 Workspace。 */
export function list_workspaces(): WorkspaceRegistryRecord[] {
  return with_cli_local_data((data) => data.workspaces.list());
}
