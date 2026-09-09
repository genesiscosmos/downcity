/**
 * Agent 本地 Session Store 实现的构造类型。
 *
 * 关键点（中文）
 * - 本地 Store 接收 AgentStorage 创建的私有 FileSystem 与存储根目录。
 * - SessionStore 与 SessionStorage 不复用项目 WorkspaceTools 的 FileSystem。
 */

import type { FileSystem, StorageDatabaseLocation } from "@downcity/type";
import type { SessionOrigin } from "@downcity/type";

/** LocalSessionStore 构造参数。 */
export interface LocalSessionStoreOptions {
  /** 当前 Agent 内部数据文件能力。 */
  files: FileSystem;
  /** 当前 Agent 内部数据的绝对根路径。 */
  storage_root_path: string;
  /** 当前 Session 查询视图所属 Agent 的稳定标识。 */
  agent_id: string;
  /** Session 数据库使用本地文件还是进程内存。 */
  database_location: StorageDatabaseLocation;
  /** 当前 Workspace 的稳定标识。 */
  workspace_id?: string;
}

/** LocalSessionDataStore 构造参数。 */
export interface LocalSessionDataStoreOptions {
  /** 当前 Agent 私有数据文件能力。 */
  files: FileSystem;
  /** 当前 Agent 内部数据的绝对根路径。 */
  storage_root_path: string;
  /** 当前 Session 所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Session 数据库使用本地文件还是进程内存。 */
  database_location: StorageDatabaseLocation;
  /** 当前 Session 所属 Workspace 的稳定标识。 */
  workspace_id?: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 的创建来源与物理存储分区。 */
  origin: SessionOrigin;
}
