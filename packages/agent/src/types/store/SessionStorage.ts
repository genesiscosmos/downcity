/**
 * 单个 Session 的结构化存储协议。
 *
 * SessionStorage 是 Session 状态、Message 聚合和 Composer 派生数据的统一事务边界。
 * 领域调用方不感知 SQLite 表、文件路径或连接实现。
 */

import type { SessionHistoryMeta } from "@/executor/types/SessionHistoryMeta.js";
import type {
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionMessage,
  SessionOrigin,
  SessionUserMessage,
  SessionUserMessagePart,
} from "@downcity/type";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

/** 在 Message 创建事务中提供的稳定状态。 */
export interface SessionMessageCreateState {
  /** 新 Message 应使用的全局线性顺序。 */
  message_sequence: number;
}

/** Message 定向更新事务。 */
export interface SessionMessageUpdate {
  /** 更新后的完整领域快照；Storage 只写 envelope 与明确列出的 Part。 */
  message: SessionMessage;
  /** 调用方读取快照时的 revision，用于拒绝并发覆盖。 */
  expected_revision: number;
  /** 本次新增或内容发生变化的 Part；每项必须属于 message。 */
  changed_parts: Array<SessionUserMessagePart | SessionAgentMessagePart>;
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

/** Composer 派生 SQL 参数允许的 SQLite 标量。 */
export type SessionStorageValue = string | number | bigint | Uint8Array | null;

/** 单个 Composer 命名空间的派生表事务。 */
export interface SessionDerivedStoreTransaction {
  /** 执行一条不返回数据的派生 SQL。 */
  execute(sql: string, parameters?: readonly SessionStorageValue[]): void;
  /** 读取第一条派生数据；没有匹配时返回空。 */
  get<TRow>(sql: string, parameters?: readonly SessionStorageValue[]): TRow | null;
  /** 读取全部匹配的派生数据。 */
  all<TRow>(sql: string, parameters?: readonly SessionStorageValue[]): TRow[];
}

/**
 * Composer 的派生表存储视图。
 *
 * 关键点（中文）：这里只暴露当前命名空间的派生表事务；canonical history 由宿主读取后
 * 以参数传给 Composer，因此 Composer 不可能改写或绕过 canonical Message。
 */
export interface SessionDerivedStore {
  /** 在短事务中操作当前命名空间的派生表。 */
  transaction<T>(operation: (transaction: SessionDerivedStoreTransaction) => T): Promise<T>;
}

/** 单个 Session 的结构化持久化能力。 */
export interface SessionStorage {
  /** 当前 Session 的稳定标识。 */
  readonly session_id: string;
  /** 当前 Session 的不可变创建来源。 */
  readonly origin: SessionOrigin;
  /** 当前 Session 的附件存储。 */
  readonly attachments: SessionAttachmentStore;

  /** 初始化 schema 并校验 Session 身份。 */
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
  /** 读取最早的 canonical User Message；空 Session 返回 null。 */
  read_first_user_message(): Promise<SessionUserMessage | null>;
  /** 在事务中分配 sequence 并创建 Message。 */
  create_message(
    build_message: (state: SessionMessageCreateState) => SessionMessage,
  ): Promise<SessionMessage>;
  /** 原子提交 Message envelope 和明确发生变化的 Part。 */
  update_message(input: SessionMessageUpdate): Promise<void>;
  /** 按 Message sequence 向前分页。 */
  list_message_page(input?: {
    /** 返回该 sequence 之前的 Message。 */
    before_sequence?: number;
    /** 单页最大 Message 数量。 */
    limit?: number;
    /** 是否包含只供运行时消费的内部 Message。 */
    include_internal?: boolean;
  }): Promise<SessionMessage[]>;
  /** 读取需要由 SessionMessages 收口的非终态 Agent Message。 */
  list_recoverable_agent_messages(): Promise<SessionAgentMessage[]>;
  /** 读取指定 Turn 的最后一条 Agent Message。 */
  read_latest_agent_message(turn_id?: string): Promise<SessionAgentMessage | null>;
  /** 读取 Message 统计。 */
  message_stats(): Promise<SessionMessageStorageStats>;
  /** 读取已持久化 Message 总数；只做计数，不读取内容。 */
  message_count(): Promise<number>;
  /** 清空 canonical Message 与依赖它们的派生数据。 */
  clear_messages(): Promise<void>;
  /** 返回指定 Composer 命名空间的派生存储视图。 */
  derived_store(namespace: string): SessionDerivedStore;
  /** 关闭数据库连接。 */
  dispose(): Promise<void>;
}
