/**
 * AdaptivePartContextPolicy 内部持久化与候选类型。
 *
 * 类型集中在 types 目录，策略模块只保留上下文选择行为。
 */

import type {
  SessionAgentMessagePart,
  SessionMessage,
  SessionUserMessagePart,
} from "@downcity/type";

/** Part 级累计摘要 checkpoint。 */
export interface AdaptivePartCheckpointRow {
  /** checkpoint 稳定标识。 */
  checkpoint_id: string;
  /** 边界所属 Message 标识。 */
  through_message_id: string;
  /** 边界所属 Message sequence。 */
  through_message_sequence: number;
  /** 边界 Part sequence。 */
  through_part_sequence: number;
  /** 累计摘要正文。 */
  summary: string;
  /** 生成派生结果的策略版本。 */
  policy_version: number;
  /** 派生记录创建时间。 */
  created_at: number;
}

/** 可参与摘要的稳定 Part 及其 canonical 位置。 */
export interface StablePartCandidate {
  /** Part 所属完整 Message。 */
  message: SessionMessage;
  /** 具体 canonical Part。 */
  part: SessionUserMessagePart | SessionAgentMessagePart;
}
