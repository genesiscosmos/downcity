/**
 * Session 集合存储类型。
 *
 * 关键点（中文）
 * - AgentSessions 只通过该接口管理 Session 生命周期和索引。
 * - 接口不暴露物理目录，避免 Session 领域重新依赖路径约定。
 */

import type {
  AgentArchiveSessionResult,
  AgentArchiveSessionsInput,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentListSessionsInput,
  AgentSessionSummaryPage,
} from "@/types/agent/SessionTypes.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionOrigin } from "@downcity/type";

/** 一个 Agent 所属全部 Session 的持久化入口。 */
export interface SessionStore {
  /** 为一个新 Session 创建稳定持久化视图；完整来源只在创建时由调用方提供。 */
  create_session(session_id: string, origin: SessionOrigin, workspace_id?: string): SessionStorage;

  /** 打开一个已有 Session；完整来源必须从数据库状态恢复。 */
  open_session(session_id: string, origin_type?: string): Promise<SessionStorage>;

  /** 判断活动 Session 是否存在。 */
  has_session(session_id: string, origin_type?: string): Promise<boolean>;

  /** 永久删除活动 Session 的全部领域数据。 */
  remove_session(session_id: string, origin_type?: string): Promise<boolean>;

  /** 清空活动 Session 的 Message 数据。 */
  clear_session_messages(session_id: string, origin_type?: string): Promise<boolean>;

  /** 返回活动 Session 摘要页。 */
  list_sessions(
    input: AgentListSessionsInput | undefined,
    executing_session_ids: ReadonlySet<string>,
  ): Promise<AgentSessionSummaryPage>;

  /** 将活动 Session 原子迁入归档区。 */
  archive_session(session_id: string, origin_type?: string): Promise<AgentArchiveSessionResult>;

  /** 返回已归档 Session 摘要页。 */
  list_archived_sessions(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult>;

  /** 永久删除全部归档 Session。 */
  clean_archive(): Promise<AgentCleanArchiveResult>;

  /** 刷新并释放当前 Store 持有的资源。 */
  dispose(): Promise<void>;
}
