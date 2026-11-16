/**
 * Agent 单库集合存储的构造参数。
 * 文件能力属于 Agent 私有数据根；数据库连接、租约与 Session 视图由集合统一拥有。
 */
import type { FileSystem, StorageDatabaseLocation } from "@downcity/type";

/** AgentSessionStore 构造参数。 */
export interface AgentSessionStoreOptions {
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

