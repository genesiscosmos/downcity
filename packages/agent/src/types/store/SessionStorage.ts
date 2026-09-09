/**
 * 单个 Session 的结构化存储协议。
 *
 * SessionStorage 是 Session 状态、Message 聚合和 Composer 派生数据的统一事务边界。
 * 领域调用方不感知 SQLite 表、文件路径或连接实现。
 */

import type { SessionHistoryMeta } from "@/executor/types/SessionHistoryMeta.js";
import type { SessionMessage, SessionOrigin } from "@downcity/type";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

/** 在 Message 创建事务中提供的稳定状态。 */
export interface SessionMessageCreateState {
  /** 新 Message 应使用的全局线性顺序。 */
  message_sequence: number;
  /** 事务开始时已经存在的完整 Message 聚合。 */
  messages: SessionMessage[];
}

/** Session Message 持久化统计。 */
export interface SessionMessageStorageStats {
  /** 当前 Session 中的真实 Message 数量。 */
  message_count: number;
  /** 当前数据库文件占用字节数；内存数据库返回零。 */
  storage_bytes: number;
  /** 当前最新 Message；空 Session 时为空。 */
  latest_message: SessionMessage | null;
}

/** Composer Policy SQL 参数允许的 SQLite 标量。 */
export type SessionStorageValue = string | number | bigint | Uint8Array | null;

/** Composer Policy 专属派生表的受限事务。 */
export interface SessionComposerStorageTransaction {
  /** 执行一条不返回数据的派生 SQL。 */
  execute(sql: string, parameters?: readonly SessionStorageValue[]): void;
  /** 读取第一条派生数据；没有匹配时返回空。 */
  get<TRow>(sql: string, parameters?: readonly SessionStorageValue[]): TRow | null;
  /** 读取全部匹配的派生数据。 */
  all<TRow>(sql: string, parameters?: readonly SessionStorageValue[]): TRow[];
}

/** Composer 对 canonical history 和专属派生表的存储视图。 */
export interface SessionComposerStorage {
  /** 按 sequence 升序读取全部 canonical Message 聚合。 */
  list_messages(): Promise<SessionMessage[]>;
  /** 在短事务中操作当前 Policy 的派生表。 */
  transaction<T>(operation: (transaction: SessionComposerStorageTransaction) => T): Promise<T>;
}

/** 单个 Session 的结构化持久化能力。 */
export interface SessionStorage {
  /** 当前 Session 的稳定标识。 */
  readonly session_id: string;
  /** 当前 Session 的不可变创建来源。 */
  readonly origin: SessionOrigin;
  /** 当前 Session 的附件存储。 */
  readonly attachments: SessionAttachmentStore;

  /** 初始化 schema、身份与中断恢复。 */
  initialize(): Promise<void>;
  /** 读取当前 Session 状态。 */
  read_metadata(): Promise<SessionHistoryMeta>;
  /** 原子覆盖当前 Session configured 状态。 */
  write_metadata(metadata: SessionHistoryMeta): Promise<void>;
  /** 判断 Session 是否存在显式 system snapshot。 */
  has_instruction(): Promise<boolean>;
  /** 读取显式 system snapshot。 */
  read_instruction(): Promise<string | null>;
  /** 原子写入显式 system snapshot。 */
  write_instruction(instruction: string): Promise<void>;

  /** 读取全部 canonical Message 聚合。 */
  list_messages(): Promise<SessionMessage[]>;
  /** 读取指定 Message。 */
  read_message(message_id: string): Promise<SessionMessage | null>;
  /** 在事务中分配 sequence 并创建 Message。 */
  create_message(
    build_message: (state: SessionMessageCreateState) => SessionMessage,
  ): Promise<SessionMessage>;
  /** 使用 expected revision 原子更新完整 Message 聚合。 */
  update_message(
    message_id: string,
    expected_revision: number,
    build_message: (current: SessionMessage) => SessionMessage,
  ): Promise<SessionMessage>;
  /** 按 Message sequence 向前分页。 */
  list_message_page(input?: {
    /** 返回该 sequence 之前的 Message。 */
    before_sequence?: number;
    /** 单页最大 Message 数量。 */
    limit?: number;
  }): Promise<SessionMessage[]>;
  /** 读取 Message 统计。 */
  message_stats(): Promise<SessionMessageStorageStats>;
  /** 清空 canonical Message 与依赖它们的派生数据。 */
  clear_messages(): Promise<void>;
  /** 返回当前 Composer Policy 的派生存储视图。 */
  composer_storage(namespace: string): SessionComposerStorage;
  /** 关闭数据库连接。 */
  dispose(): Promise<void>;
}
