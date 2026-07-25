/**
 * Session Store 类型。
 *
 * 关键点（中文）
 * - Session 领域只依赖这些持久化能力，不感知 JSONL、目录或文件名。
 * - Message、Metadata 与 Instruction 共享同一个 Session 生命周期边界。
 */

import type { SessionHistoryMetaV1 } from "@/executor/types/SessionHistoryMeta.js";
import type {
  SessionAssistantMessage,
  SessionMessage,
} from "@/types/session/SessionMessage.js";
import type {
  SessionMessageStorageStats,
  SessionSegmentRange,
  SessionSegmentSnapshot,
  SessionSegmentSummary,
} from "@/types/session/SessionSegment.js";

/** 在 Message Store 写事务中创建新消息所需的稳定状态。 */
export interface SessionMessageCommitState {
  /** 下一条真实 Message 应使用的全局线性顺序。 */
  message_sequence: number;
  /** 当前 Active 与 Assistant 草稿组成的运行态 Message。 */
  messages: SessionMessage[];
}

/** Active Message 压缩提交参数。 */
export interface CompactActiveMessagesInput {
  /** 移入新 Segment 的最后一条真实 Message sequence。 */
  through_sequence: number;
  /** 写入新 Segment 末尾的累计上下文摘要。 */
  summary: SessionSegmentSummary;
}

/** Active Message 压缩提交结果。 */
export interface CompactActiveMessagesResult {
  /** 本次创建的不可变历史分段。 */
  segment: SessionSegmentSnapshot;
  /** 压缩后继续保留在 Active 区域的 Message。 */
  active_messages: SessionMessage[];
}

/** Session Message 持久化能力。 */
export interface SessionMessageStore {
  /** 初始化消息存储，并修复可恢复的中断状态。 */
  initialize(): Promise<void>;
  /** 读取当前 Active Message 与运行中的 Assistant 草稿。 */
  list_messages(): Promise<SessionMessage[]>;
  /** 读取指定 sequence 之前最近的完整历史分段。 */
  read_segment_before(before_sequence: number): Promise<SessionSegmentSnapshot | null>;
  /** 读取最新历史分段的累计摘要。 */
  read_latest_summary(): Promise<SessionSegmentSummary | null>;
  /** 读取当前 Session 的全部真实历史消息。 */
  list_history_messages(): Promise<SessionMessage[]>;
  /** 读取消息数量、存储大小与最新消息统计。 */
  stats(): Promise<SessionMessageStorageStats>;
  /** 判断指定 sequence 之前是否存在历史分段。 */
  has_segment_before(before_sequence: number): Promise<boolean>;
  /** 计算当前 Active Message 之前的读取边界。 */
  active_before_sequence(messages: SessionMessage[]): Promise<number | undefined>;
  /** 读取当前运行中的 Assistant 草稿。 */
  read_assistant_message(): Promise<SessionAssistantMessage | null>;
  /** 原子覆盖当前运行中的 Assistant 草稿。 */
  write_assistant_message(message: SessionAssistantMessage): Promise<void>;
  /** 在存储事务中创建唯一 Assistant 草稿。 */
  create_assistant_message(
    build_message: (state: SessionMessageCommitState) => SessionAssistantMessage,
  ): Promise<SessionAssistantMessage>;
  /** 在存储事务中追加一条 Message。 */
  append_message(
    build_message: (state: SessionMessageCommitState) => SessionMessage,
  ): Promise<SessionMessage>;
  /** 提交最终 Assistant Message 并删除运行中草稿。 */
  finalize_assistant_message(message: SessionAssistantMessage): Promise<void>;
  /** 将 Active 前缀压缩为不可变历史分段。 */
  compact_active(input: CompactActiveMessagesInput): Promise<CompactActiveMessagesResult>;
  /** 读取全部历史分段的 sequence 索引。 */
  list_segment_ranges(): Promise<SessionSegmentRange[]>;
}

/** 单个 Session 的领域持久化视图。 */
export interface SessionStore {
  /** 当前 Session 的稳定标识。 */
  readonly session_id: string;

  /** 当前 Session 的 Message 持久化能力。 */
  readonly messages: SessionMessageStore;

  /** 读取 Session Metadata；不存在时返回规范化的初始值。 */
  read_metadata(): Promise<SessionHistoryMetaV1>;

  /** 原子写入完整 Session Metadata。 */
  write_metadata(metadata: SessionHistoryMetaV1): Promise<void>;

  /** 判断 Session 是否存在显式固化的完整 system。 */
  has_instruction(): Promise<boolean>;

  /** 读取显式固化的完整 system；不存在时返回 null。 */
  read_instruction(): Promise<string | null>;

  /** 原子写入显式固化的完整 system。 */
  write_instruction(instruction: string): Promise<void>;
}
