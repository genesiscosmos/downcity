/**
 * 本地 Workspace Store 实现的构造类型。
 *
 * 关键点（中文）
 * - 本地 Store 接收 AgentWorkspaceStorage 创建的私有 FileSystem 与存储根目录。
 * - SessionStore 与 SessionDataStore 不复用项目 WorkspaceTools 的 FileSystem。
 */

import type { FileSystem } from "@downcity/workspace";

/** LocalSessionStore 构造参数。 */
export interface LocalSessionStoreOptions {
  /** 当前 Workspace 内部数据文件能力。 */
  files: FileSystem;
  /** 当前 Workspace 内部数据的绝对根路径。 */
  storage_root_path: string;
  /** 当前 Session 查询视图所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Workspace 的稳定标识。 */
  workspace_id: string;
}

/** LocalSessionDataStore 构造参数。 */
export interface LocalSessionDataStoreOptions {
  /** 当前 AgentWorkspace 私有数据文件能力。 */
  files: FileSystem;
  /** 当前 AgentWorkspace 内部数据的绝对根路径。 */
  storage_root_path: string;
  /** 当前 Session 所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Session 所属 Workspace 的稳定标识。 */
  workspace_id: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
}

/** JsonlSessionMessageStore 构造参数。 */
export interface JsonlSessionMessageStoreOptions {
  /** 当前 Message Store 使用的 AgentWorkspace 私有文件能力。 */
  files: FileSystem;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** Active JSONL 文件的绝对路径。 */
  file_path: string;
  /** Assistant 运行中快照的可选绝对路径。 */
  assistant_message_file_path?: string;
}
