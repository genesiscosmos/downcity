/**
 * Composer 上下文 checkpoint 派生类型。
 *
 * checkpoint 记录「累计摘要已经覆盖到哪个 canonical Part」，属于 Composer 自己的派生
 * 数据：可以随时删除并从 canonical history 重新累积，不参与 Session Message 语义。
 */

import type {
  SessionAgentMessagePart,
  SessionMessage,
  SessionUserMessagePart,
} from "@downcity/type";

/** Part 级累计摘要 checkpoint。 */
export interface ContextCheckpointRow {
  /** checkpoint 稳定标识。 */
  checkpoint_id: string;
  /** 边界所属 Message 标识。 */
  through_message_id: string;
  /** 边界所属 Message sequence。 */
  through_message_sequence: number;
  /** 边界 Part sequence；边界可以落在单个 Message 内部。 */
  through_part_sequence: number;
  /** 截至边界的累计摘要正文。 */
  summary: string;
  /** 生成派生结果时的 schema 版本；不兼容的旧表会被重建。 */
  schema_version: number;
  /** 派生记录创建时间。 */
  created_at: number;
}

/** 可参与摘要的稳定 Part 及其 canonical 位置。 */
export interface StableContextPart {
  /** Part 所属完整 Message。 */
  message: SessionMessage;
  /** 具体 canonical Part。 */
  part: SessionUserMessagePart | SessionAgentMessagePart;
}
