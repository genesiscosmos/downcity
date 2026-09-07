/**
 * Session Message 物理分段类型。
 *
 * Segment 保存一段连续的原始 Message，并在文件末尾保存覆盖到该段末尾的累计 Summary。
 * Summary 只服务模型上下文，不占用 Session Message sequence。
 */

import type { SessionMessage } from "@downcity/type";

/** 已关闭 Segment 的累计上下文摘要。 */
export interface SessionSegmentSummary {
  /** 记录类型固定为 summary，用于和原始 Message 行区分。 */
  record_type: "summary";
  /** 当前 Summary 所属 Session 标识。 */
  session_id: string;
  /** 当前 Summary 的稳定唯一标识。 */
  summary_id: string;
  /** 当前 Summary 已覆盖到的最后一条真实 Message sequence。 */
  through_sequence: number;
  /** 供下一轮模型直接使用的累计摘要文本。 */
  text: string;
  /** 当前 Summary 创建时间戳（ms）。 */
  created_at: number;
}

/** 已关闭 Segment 的 sequence 范围与文件位置。 */
export interface SessionSegmentRange {
  /** Segment 内第一条真实 Message sequence。 */
  start_sequence: number;
  /** Segment 内最后一条真实 Message sequence。 */
  end_sequence: number;
  /** Segment JSONL 文件的绝对路径。 */
  file_path: string;
}

/** 从一个已关闭 Segment 读取出的完整数据。 */
export interface SessionSegmentSnapshot {
  /** Segment 的 sequence 范围。 */
  range: SessionSegmentRange;
  /** Segment 中按 sequence 升序排列的原始 Message。 */
  messages: SessionMessage[];
  /** Segment 文件末尾的累计 Summary。 */
  summary: SessionSegmentSummary;
}

/** 当前模型上下文所需的最小 Session 快照。 */
export interface SessionContextSnapshot {
  /** 最新已关闭 Segment 的累计 Summary；从未 Compact 时为空。 */
  summary: SessionSegmentSummary | null;
  /** Active 中上次 Compact 后产生的全部真实 Message。 */
  messages: SessionMessage[];
}

/** Session 历史存储统计。 */
export interface SessionMessageStorageStats {
  /** 当前 Session 已分配的真实 Message 总数。 */
  message_count: number;
  /** Active 与所有 Segment 文件占用的总字节数。 */
  history_bytes: number;
  /** 当前最新真实 Message；空 Session 时为空。 */
  latest_message: SessionMessage | null;
}
