/**
 * Credits 服务内部运行时类型。
 *
 * 这些类型只用于连接账务编排与原子 SQL 命令构造，不属于 package 公开 API。
 */

import type { CreditsTransactionKind } from "./Transaction.js";

/** 一次 Charge 从单张 Card 分配的额度。 */
export interface CreditsCardAllocation {
  /** Card 类型。 */
  card_kind: "primary" | "ephemeral";
  /** Primary 使用 user_id，Ephemeral 使用 card_id。 */
  card_id: string;
  /** Card 所属用户 ID。 */
  user_id: string;
  /** 本次从 Card 扣除的正数额度。 */
  credits: number;
}

/** 已归一化、可持久化的 Transaction 请求快照。 */
export interface CreditsTransactionRequest {
  /** Transaction 类型。 */
  kind: CreditsTransactionKind;
  /** 用户 ID。 */
  user_id: string;
  /** 正数总额度。 */
  credits: number;
  /** 幂等键。 */
  idempotency_key: string;
  /** 标准化请求 JSON。 */
  request_json: string;
  /** 业务来源。 */
  source: string;
  /** 外部引用。 */
  ref: string;
  /** 说明。 */
  note: string;
  /** 审计信息 JSON。 */
  metadata_json: string;
}
