/** CLI Workspace 配置适配层。 */

import { LocalCityStore } from "@downcity/city";
import type { LocalWorkspaceConfig } from "@downcity/city";

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

/** 规范化 Workspace 路径。 */
export function normalize_workspace_path(input: string): string {
  return String(input || "").trim();
}

/** 在短连接 Store 上执行 Workspace 查询。 */
function with_local_store<T>(action: (store: LocalCityStore) => T): T {
  const store = new LocalCityStore();
  try {
    return action(store);
  } finally {
    store.close();
  }
}

/** 创建或读取同一路径 Workspace。 */
export function create_workspace(input: CreateWorkspaceRegistryInput): WorkspaceRegistryRecord {
  return with_local_store((store) => store.ensure_workspace(input));
}

/** 按 ID 读取 Workspace。 */
export function get_workspace(workspace_id: string): WorkspaceRegistryRecord | null {
  return with_local_store((store) => store.get_workspace_config(workspace_id));
}

/** 按路径读取 Workspace。 */
export function get_workspace_by_path(workspace_path: string): WorkspaceRegistryRecord | null {
  return with_local_store((store) => store.get_workspace_config_by_path(workspace_path));
}

/** 列出全部 Workspace。 */
export function list_workspaces(): WorkspaceRegistryRecord[] {
  return with_local_store((store) => store.list_workspace_configs());
}
