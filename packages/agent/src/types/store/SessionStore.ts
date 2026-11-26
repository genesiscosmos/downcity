/**
 * Session 集合存储类型。
 *
 * 关键点（中文）
 * - AgentSessions 只通过该接口管理 Session 生命周期和索引。
 * - 接口不暴露物理目录，避免 Session 领域重新依赖路径约定。
 */

import type { AgentArchiveSessionResult, AgentArchiveSessionsInput, AgentArchiveSessionsResult, AgentCleanArchiveResult, AgentListSessionsInput, AgentSessionSummaryPage } from "@/types/agent/SessionTypes.js";
import type { SessionReadView } from "./SessionReadView.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionDescriptor } from "@downcity/type";
import type { AgentInteraction } from "@/types/agent/AgentInteractions.js";

/** 一个 Agent 所属全部 Session 的持久化入口。 */
export interface SessionStore {
  /** 共享 Agent DB 的通用 JSON 变量，无 Session 外键或业务键解释。 */
  readonly variables: import("../agent/AgentVariables.js").AgentVariables;

  /** 为一个新 Session 创建稳定持久化视图；完整来源只在创建时由调用方提供。 */
  create_session(session_id: string, descriptor: SessionDescriptor, workspace_id?: string, title?: string): SessionStorage;

  /** 持久业务创建键关联新 UUID；归档和删除不允许以原键复活或改选。 */
  ensure_creation(creation_key: string, descriptor: SessionDescriptor, workspace_id?: string): Promise<SessionStorage>;

  /** 打开一个已有 Session；完整来源必须从数据库状态恢复。 */
  open_session(session_id: string, type?: string): Promise<SessionStorage>;

  /** 按输入顺序批量读取最多 100 条精确元数据；不存在为 null，存储失败继续抛出。 */
  read_metadata(addresses: readonly import("@/types/agent/SessionMetadata.js").SessionMetadataAddress[]): Promise<(import("@/types/agent/SessionMetadata.js").SessionMetadataResult | null)[]>;

  /** 读取活动逻辑地址，不回落归档，不恢复执行器或修改生命周期。 */
  read_session(session_id: string, type: string): Promise<SessionReadView>;

  /** 通过稳定记录 UUID 精确读取归档，不猜同逻辑 ID 的任意归档记录。 */
  read_archived_session(session_id: string): Promise<SessionReadView>;

  /** 永久删除一条精确归档记录，并在同一事务登记附件清理。 */
  remove_archived_session(session_id: string): Promise<boolean>;

  /** 只读查询所有来源的活动 pending 交互；不恢复 Session 或扫描完整历史。 */
  list_pending_interactions(): Promise<AgentInteraction[]>;

  /** 判断活动 Session 是否存在。 */
  has_session(session_id: string, type?: string): Promise<boolean>;

  /** 永久删除活动 Session 的全部领域数据。 */
  remove_session(session_id: string, type?: string): Promise<boolean>;

  /** 清空活动 Session 的 Message 数据。 */
  clear_session_messages(session_id: string, type?: string): Promise<boolean>;

  /** 返回活动 Session 摘要页。 */
  list_sessions(
    input: AgentListSessionsInput | undefined,
    executing_session_ids: ReadonlySet<string>,
  ): Promise<AgentSessionSummaryPage>;

  /** 创建或恢复原持久化后序UUID归档计划，不重扫已有操作。 */
  prepare_archive(input: import("./AgentArchivePlan.js").AgentArchivePlanInput): Promise<import("./AgentArchivePlan.js").AgentArchivePlan>;
  /** 按原计划位置原子归档节点并推进持久进度。 */
  commit_archive_node(input: import("./AgentArchivePlan.js").AgentArchiveNodeCommit): Promise<import("./AgentArchivePlan.js").AgentArchivePlan>;
  /** 读取原操作计划，用于重入和可信权限核对。 */
  read_archive_plan(operation_id: string): Promise<import("./AgentArchivePlan.js").AgentArchivePlan | null>;

  /** 将活动 Session 原子迁入归档区。 */
  archive_session(session_id: string, type?: string): Promise<AgentArchiveSessionResult>;

  /** 返回已归档 Session 摘要页。 */
  list_archived_sessions(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult>;

  /** 永久删除全部归档 Session。 */
  clean_archive(): Promise<AgentCleanArchiveResult>;

  /** 刷新并释放当前 Store 持有的资源。 */
  dispose(): Promise<void>;
}
