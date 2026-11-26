/**
 * 单个 Session 的结构化存储协议。
 *
 * SessionStorage 是 Session 状态、Message 聚合和 Composer 派生数据的统一事务边界。
 * 领域调用方不感知 SQLite 表、文件路径或连接实现。
 */

import type { SessionHistoryMeta } from "@/types/store/SessionHistoryMeta.js";
import type { SessionAgentInputPart, SessionAgentMessage, SessionAgentMessagePart, SessionMessage, SessionDescriptor, SessionUserMessage, SessionUserMessagePart } from "@downcity/type";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

/** 不含存储分配序号的新消息候选；Worker 提交后返回最终完整聚合。 */
export type SessionMessageCreateInput = Omit<SessionUserMessage, "sequence"> | Omit<SessionAgentMessage, "sequence">;

/** 消息创建的主线程派发检查点；不随候选正文传入 Worker。 */
export interface SessionMessageCreateOptions {
  /** 未派发前最终校验是否仍可接受输入，抛错不发送事务。 */
  assert_receivable?: () => void;
}

/** Message 定向更新事务。 */
export interface SessionMessageUpdate {
  /** 可信新输入在事务写入前的最终接收校验；抛错时整个提交回滚。 */
  assert_receivable?: () => void;
  /** 更新后的完整领域快照；Agent stable_part_sequence 只能推进，已有稳定前缀必须与数据库一致。 */
  message: SessionMessage;
  /** 调用方读取快照时的 revision，用于拒绝并发覆盖。 */
  expected_revision: number;
  /** 本次新增或内容发生变化的 Part；每项必须属于 message，稳定前缀只能携带未变化的同值 Part。 */
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

/**
 * 单 Session、单 Composer 命名空间的可序列化派生能力。
 * canonical history 由宿主传给 Composer；所有存储请求都是数据，不跨 Worker 传递 SQL 回调。
 */
export interface SessionDerivedStore {
  /** 读取当前 namespace 和指定格式的最近累计摘要，不加载其他 Session。 */
  read_checkpoint(schema_version: number): Promise<import("../session/ContextCheckpoint.js").ContextCheckpointRow | null>;
  /** 原子提交累计摘要，存储端验证消息与完整稳定单元边界。 */
  insert_checkpoint(checkpoint: import("../session/ContextCheckpoint.js").ContextCheckpointRow): Promise<void>;
}

/** 单个 Session 的结构化持久化能力。 */
export interface SessionStorage extends SessionDescriptor {
  /** 当前 Session 的永久唯一 UUID。 */
  readonly session_id: string;

  /** 当前 Session 的附件存储。 */
  readonly attachments: SessionAttachmentStore;

  /** 初始化 schema 并校验 Session 身份。 */
  initialize(): Promise<void>;
  /** 读取当前 Session 状态。 */
  read_metadata(): Promise<SessionHistoryMeta>;
  /** 原子覆盖当前 Session configured 状态。 */
  write_metadata(metadata: SessionHistoryMeta): Promise<void>;
  /** 原子绑定不可变执行配置；已有配置不一致时拒绝，供幂等创建和恢复使用。 */
  bind_execution_profile(reference: import("@/types/agent/SessionExecutionProfile.js").SessionExecutionProfileReference): Promise<void>;
  /** 判断 Session 是否存在显式 system snapshot。 */
  has_instruction(): Promise<boolean>;
  /** 读取显式 system snapshot。 */
  read_instruction(): Promise<string | null>;
  /** 原子写入显式 system snapshot。 */
  write_instruction(instruction: string): Promise<void>;

  /** 读取全部 canonical Message 聚合。 */
  list_messages(): Promise<SessionMessage[]>;
  /** 在存储拥有者侧读取输入内容版本、附件引用和交互状态，不返回历史正文。 */
  read_input_versions(): Promise<import("./SessionInputVersions.js").SessionInputVersions>;
  /** 检查 canonical 用户消息或 Input 内容是否登记该精确附件路径，不加载完整历史。 */
  has_attachment(file_path: string): Promise<boolean>;
  /** 读取指定 Message。 */
  read_message(message_id: string): Promise<SessionMessage | null>;
  /** 通过 canonical Part 主键读取所属消息，供分支中保留的结果引用精确定位。 */
  read_part_message(part_id: string): Promise<SessionMessage | null>;
  /** 读取当前 Session 内已接收的 Input 输入，供幂等接收与 fork 后重试定位。 */
  read_input(input_id: string): Promise<{
    /** 包含该 Input Part 的完整 canonical Agent Message。 */
    message: SessionAgentMessage;
    /** 保留稳定身份、内容及接收时间的 Input Part。 */
    part: SessionAgentInputPart;
  } | null>;
  /** 读取最早的 canonical User Message；空 Session 返回 null。 */
  read_first_user_message(): Promise<SessionUserMessage | null>;
  /** 在事务中分配 sequence 并创建 Message。 */
  create_message(
    message: SessionMessageCreateInput,
    options?: SessionMessageCreateOptions,
  ): Promise<SessionMessage>;
  /** 原子写入变化 Parts 后提交 envelope 与稳定水位；拒绝前缀修改、删除、越界及未终态边界。 */
  update_message(input: SessionMessageUpdate): Promise<void>;
  /** 按 Message sequence 向前分页。 */
  list_message_page(input?: {
    /** 返回该 sequence 之前的 Message。 */
    before_sequence?: number;
    /** 单页最大 Message 数量。 */
    limit?: number;
  }): Promise<SessionMessage[]>;
  /** 读取需要由 SessionMessages 收口的非终态 Agent Message。 */
  list_recoverable_agent_messages(): Promise<SessionAgentMessage[]>;
  /** 读取指定 Turn 的最后一条 Agent Message。 */
  read_latest_agent_message(turn_id?: string): Promise<SessionAgentMessage | null>;
  /** 读取 Message 统计。 */
  message_stats(): Promise<SessionMessageStorageStats>;
  /** 读取已持久化 Message 总数；只做计数，不读取内容。 */
  message_count(): Promise<number>;
  /** 原子删除指定 sequence 之后的 Message 与关联派生数据，保留其余消息身份。 */
  truncate_messages(through_sequence: number): Promise<void>;
  /** 清空 canonical Message 与依赖它们的派生数据。 */
  clear_messages(): Promise<void>;
  /** 返回指定 Composer 命名空间的派生存储视图。 */
  derived_store(namespace: string): SessionDerivedStore;
  /** 关闭数据库连接。 */
  dispose(): Promise<void>;
}
