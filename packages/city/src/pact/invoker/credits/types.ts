/**
 * Credits 管理端公开类型。
 *
 * 本模块描述 Bureau 通过 Federation HTTP API 读写的 Card、Transaction 与 Entry。
 */

/** Bureau 可定位的一张 Credits Card。 */
export type CreditsCardReference =
  | {
      /** Card 类型，固定为 primary。 */
      kind: "primary";
      /** Primary Card 所属用户 ID。 */
      user_id: string;
    }
  | {
      /** Card 类型，固定为 ephemeral。 */
      kind: "ephemeral";
      /** Ephemeral Card 唯一 ID。 */
      card_id: string;
    };

/** 用户唯一的永久 Credits Card。 */
export interface CreditsPrimaryCard extends Record<string, unknown> {
  /** Card 类型，固定为 primary。 */
  kind: "primary";
  /** Card 所属用户 ID。 */
  user_id: string;
  /** 当前永久额度。 */
  credits: number;
  /** Card 创建时间。 */
  created_at: string;
  /** Card 最近更新时间。 */
  updated_at: string;
}

/** 用户的一张限时 Credits Card。 */
export interface CreditsEphemeralCard extends Record<string, unknown> {
  /** Card 类型，固定为 ephemeral。 */
  kind: "ephemeral";
  /** Card 唯一 ID。 */
  card_id: string;
  /** Card 所属用户 ID。 */
  user_id: string;
  /** Card 展示名称。 */
  name: string;
  /** 当前剩余额度。 */
  credits: number;
  /** Card 到期时间。 */
  expires_at: string;
  /** Card 创建来源。 */
  source: string;
  /** 外部业务记录 ID。 */
  ref: string;
  /** Card 创建时间。 */
  created_at: string;
  /** Card 最近更新时间。 */
  updated_at: string;
  /** Card 当前状态。 */
  status: "active" | "depleted" | "expired";
}

/** 用户全部当前 Credits Card。 */
export interface CreditsCardsView extends Record<string, unknown> {
  /** 用户唯一的 Primary Card。 */
  primary: CreditsPrimaryCard;
  /** 当前仍有效且有余额的 Ephemeral Cards，按到期时间升序排列。 */
  ephemeral: CreditsEphemeralCard[];
}

/** 用户当前 Credits 账户视图。 */
export interface CreditsAccount extends Record<string, unknown> {
  /** 用户 ID。 */
  user_id: string;
  /** 当前总可用额度。 */
  available_credits: number;
  /** 按 Card 生命周期组织的当前额度。 */
  cards: CreditsCardsView;
}

/** 管理端 Credits 用户列表项。 */
export interface CreditsUserSummary extends Record<string, unknown> {
  /** 用户 ID。 */
  user_id: string;
  /** 当前总可用额度。 */
  available_credits: number;
  /** Primary Card 当前余额。 */
  primary_credits: number;
  /** 当前有效 Ephemeral Cards 的余额总和。 */
  ephemeral_credits: number;
  /** 当前有效且有余额的 Ephemeral Card 数量。 */
  active_ephemeral_cards: number;
}

/** Credits Transaction。 */
export interface CreditsTransaction extends Record<string, unknown> {
  /** Transaction 唯一 ID。 */
  transaction_id: string;
  /** Transaction 类型。 */
  kind: "topup" | "charge";
  /** Transaction 所属用户 ID。 */
  user_id: string;
  /** 本次变动的正数总额度。 */
  credits: number;
  /** Transaction 状态。 */
  status: "pending" | "applied";
  /** 调用方稳定幂等键。 */
  idempotency_key: string;
  /** 业务来源。 */
  source: string;
  /** 外部业务记录 ID。 */
  ref: string;
  /** 人类可读说明。 */
  note: string;
  /** 结构化审计信息 JSON。 */
  metadata_json: string;
  /** 创建时间。 */
  created_at: string;
  /** 完成时间。 */
  applied_at: string | null;
}

/** Transaction 对一张 Card 的不可变额度变化。 */
export interface CreditsTransactionEntry extends Record<string, unknown> {
  /** Entry 唯一 ID。 */
  entry_id: string;
  /** 所属 Transaction ID。 */
  transaction_id: string;
  /** Card 所属用户 ID。 */
  user_id: string;
  /** Card 类型。 */
  card_kind: "primary" | "ephemeral";
  /** Primary 使用 user_id，Ephemeral 使用 card_id。 */
  card_id: string;
  /** 本条额度变化，Topup 为正、Charge 为负。 */
  credits_delta: number;
  /** 变化后的 Card 余额。 */
  credits_after: number;
  /** 创建时间。 */
  created_at: string;
}

/** 创建 Ephemeral Card 的输入。 */
export interface CreditsEphemeralCardCreateInput {
  /** Card 所属用户 ID。 */
  user_id: string;
  /** Card 展示名称。 */
  name: string;
  /** 创建时写入的正数额度。 */
  initial_credits: number;
  /** 必须晚于当前时间的到期时间。 */
  expires_at: string;
  /** Card 创建来源。 */
  source: string;
  /** 外部业务记录 ID。 */
  ref?: string;
  /** 稳定幂等键。 */
  idempotency_key: string;
  /** 人类可读说明。 */
  note?: string;
  /** 结构化审计信息。 */
  metadata?: Record<string, unknown>;
}

/** 给指定 Card 增加额度的输入。 */
export interface CreditsTopupInput {
  /** 接收额度的 Card。 */
  card: CreditsCardReference;
  /** 增加的正数额度。 */
  credits: number;
  /** Topup 来源。 */
  source: string;
  /** 外部业务记录 ID。 */
  ref?: string;
  /** 稳定幂等键。 */
  idempotency_key: string;
  /** 人类可读说明。 */
  note?: string;
  /** 结构化审计信息。 */
  metadata?: Record<string, unknown>;
}

/** 从用户 Card 消费额度的输入。 */
export interface CreditsChargeInput {
  /** 被扣费用户 ID。 */
  user_id: string;
  /** 消费的正数额度。 */
  credits: number;
  /** 可选指定 Card。 */
  card?: CreditsCardReference;
  /** 稳定幂等键。 */
  idempotency_key: string;
  /** Charge 来源。 */
  source: string;
  /** 外部业务记录 ID。 */
  ref?: string;
  /** 人类可读说明。 */
  note?: string;
  /** 结构化审计信息。 */
  metadata?: Record<string, unknown>;
}

/** Ephemeral Card 查询条件。 */
export interface CreditsEphemeralCardQuery {
  /** 可选用户 ID。 */
  user_id?: string;
  /** 是否包含已耗尽和已过期 Card。 */
  include_history?: boolean;
  /** 返回条数上限。 */
  limit?: number | string;
}

/** Transaction 查询条件。 */
export interface CreditsTransactionQuery {
  /** 可选用户 ID。 */
  user_id?: string;
  /** 可选 Transaction 类型。 */
  kind?: "topup" | "charge";
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

/** Credits 用户查询条件。 */
export interface CreditsUserQuery {
  /** 返回条数上限。 */
  limit?: number | string;
}
