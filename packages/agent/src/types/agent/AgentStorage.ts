/**
 * Agent 级持久化存储。
 *
 * Agent 在 City 中使用持久化文件系统；未加入 City 时使用进程内文件系统。
 * Workspace 只提供执行上下文，不拥有这份存储。
 */

import type { SessionStore } from "@/types/store/SessionStore.js";
import type { FileSystem, StorageDatabaseLocation } from "@downcity/type";

/** Agent 持有的 Session、日志与调度共享存储。 */
export interface AgentStorage {
  /** Agent 内部数据的稳定根路径。 */
  root_path: string;
  /** 受当前 Agent 根路径约束的文件能力。 */
  files: FileSystem;
  /** Agent 私有结构化数据库使用的位置类型。 */
  database_location: StorageDatabaseLocation;
  /** 当前 Agent 的 Session 集合存储。 */
  sessions: SessionStore;
}
