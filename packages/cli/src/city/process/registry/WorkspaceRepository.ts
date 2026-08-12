/**
 * CLI Workspace Registry 适配层。
 *
 * Workspace 是独立项目资源目录。该模块不理解 Agent，也不保存二者之间的绑定。
 */

import {
  create_workspace_registry_record,
  get_workspace_registry_record,
  get_workspace_registry_record_by_path,
  list_workspace_registry_records,
  normalize_agent_registry_workspace,
  type CreateWorkspaceRegistryInput,
  type WorkspaceRegistryRecord,
} from "@downcity/agent-registry";

export type {
  CreateWorkspaceRegistryInput,
  WorkspaceRegistryRecord,
};

/** 规范化 Workspace 路径。 */
export const normalize_workspace_path = normalize_agent_registry_workspace;

/** 创建或读取同一路径的 Workspace。 */
export function create_workspace(
  input: CreateWorkspaceRegistryInput,
): WorkspaceRegistryRecord {
  return create_workspace_registry_record(input);
}

/** 按 ID 读取 Workspace。 */
export function get_workspace(workspace_id: string): WorkspaceRegistryRecord | null {
  return get_workspace_registry_record(workspace_id);
}

/** 按路径读取 Workspace。 */
export function get_workspace_by_path(workspace_path: string): WorkspaceRegistryRecord | null {
  return get_workspace_registry_record_by_path(workspace_path);
}

/** 列出全部 Workspace。 */
export function list_workspaces(): WorkspaceRegistryRecord[] {
  return list_workspace_registry_records();
}
