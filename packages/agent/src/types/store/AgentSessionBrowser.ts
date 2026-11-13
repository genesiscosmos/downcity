/**
 * Agent Session 只读浏览的公开构造与归档地址契约。
 * 资源只属于存储租约；浏览不创建执行器、数据库或 Session 记录。
 */
import type { AgentSessionRuntimeLease } from "./AgentSessionRuntime.js";

/** 独立浏览入口的资源范围。 */
export interface AgentSessionBrowserOptions {
  /** Agent 私有绝对根目录，不能使用 Workspace 项目目录。 */
  storage_root_path: string;
  /** 必须与数据库权威拥有者一致的 Agent ID。 */
  agent_id: string;
  /** 宿主已取得离线共享读取租约；仍读取已提交 WAL，不忽略日志。 */
  immutable?: boolean;
  /** 可选共享租约获取入口；内存模式必须由同一 AgentStorage 提供，不能另开 :memory:。 */
  acquire_read_lease?: () => Promise<AgentSessionRuntimeLease>;
}

/** 归档历史的精确地址，逻辑 Session ID 只用于交叉校验。 */
export interface AgentArchivedSessionAddress {
  /** 列表返回的不可变记录 UUID，必须原样传回。 */
  storage_id: string;
  /** 可选逻辑 ID 校验；不能用于推测 storage_id。 */
  session_id?: string;
  /** 可选分类校验；不能用于跨分类扫描。 */
  category?: string;
}
