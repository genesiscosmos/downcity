/**
 * Credits Transaction 与流水类型。
 */

/** Credits Transaction 类型。 */
export type CreditsTransactionKind = "topup" | "charge";

/** Credits Transaction 状态。 */
export type CreditsTransactionStatus = "pending" | "applied";

/** 一次完整的 Credits 业务变动与幂等边界。 */
export interface CreditsTransaction extends Record<string, unknown> {
  /** Transaction 唯一 ID。 */
  transaction_id: string;
  /** Transaction 类型。 */
  kind: CreditsTransactionKind;
  /** Transaction 所属用户 ID。 */
  user_id: string;
  /** 本次变动总额度；始终为正安全整数。 */
  credits: number;
  /** Transaction 当前状态。 */
  status: CreditsTransactionStatus;
  /** 同一种 Transaction 内的稳定幂等键。 */
  idempotency_key: string;
  /** 业务来源。 */
  source: string;
  /** 外部支付、活动、任务或模型调用 ID。 */
  ref: string;
  /** 人类可读说明。 */
  note: string;
  /** 结构化审计信息 JSON 文本。 */
  metadata_json: string;
  /** Transaction 创建时间。 */
  created_at: string;
  /** Transaction 完成时间；pending 时为空。 */
  applied_at: string | null;
}

/** 一次 Transaction 对一张 Card 的不可变额度变化。 */
export interface CreditsTransactionEntry extends Record<string, unknown> {
  /** Entry 唯一 ID。 */
  entry_id: string;
  /** 所属 Transaction ID。 */
  transaction_id: string;
  /** Card 所属用户 ID。 */
  user_id: string;
  /** 目标 Card 类型。 */
  card_kind: "primary" | "ephemeral";
  /** Primary Card 使用 user_id，Ephemeral Card 使用 card_id。 */
  card_id: string;
  /** Topup 为正、Charge 为负的额度变化。 */
  credits_delta: number;
  /** 本条变化提交后的 Card 余额。 */
  credits_after: number;
  /** Entry 创建时间。 */
  created_at: string;
}

/** Transaction 查询条件。 */
export interface CreditsTransactionQuery {
  /** 可选用户 ID。 */
  user_id?: string;
  /** 可选 Transaction 类型。 */
  kind?: CreditsTransactionKind | string;
  /** 返回条数上限。 */
  limit?: number | string;
}

/** Transaction Entry 查询条件。 */
export interface CreditsHistoryQuery {
  /** 可选用户 ID。 */
  user_id?: string;
  /** 可选 Transaction ID。 */
  transaction_id?: string;
  /** 返回条数上限。 */
  limit?: number | string;
}
