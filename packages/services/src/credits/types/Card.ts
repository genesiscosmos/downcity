/**
 * Credits Card 公开类型。
 *
 * Primary Card 保存永久额度；Ephemeral Card 保存具有明确到期时间的临时额度。
 */

/** Ephemeral Card 当前状态。 */
export type CreditsEphemeralCardStatus = "active" | "depleted" | "expired";

/** 用户唯一的永久 Credits Card。 */
export interface CreditsPrimaryCard extends Record<string, unknown> {
  /** Card 类型，固定为 primary。 */
  kind: "primary";
  /** Card 所属用户 ID，同时也是持久化主键。 */
  user_id: string;
  /** 当前永久额度，单位为 credits。 */
  credits: number;
  /** Card 创建时间。 */
  created_at: string;
  /** Card 最近更新时间。 */
  updated_at: string;
}

/** 用户获得的一张限时 Credits Card。 */
export interface CreditsEphemeralCard extends Record<string, unknown> {
  /** Card 类型，固定为 ephemeral。 */
  kind: "ephemeral";
  /** Card 唯一 ID。 */
  card_id: string;
  /** Card 所属用户 ID。 */
  user_id: string;
  /** 面向用户展示的 Card 名称。 */
  name: string;
  /** 当前剩余额度，单位为 credits。 */
  credits: number;
  /** Card 到期时间。 */
  expires_at: string;
  /** Card 创建来源。 */
  source: string;
  /** 外部活动、任务或业务记录 ID。 */
  ref: string;
  /** Card 创建时间。 */
  created_at: string;
  /** Card 最近更新时间。 */
  updated_at: string;
  /** 根据余额和到期时间计算的当前状态。 */
  status: CreditsEphemeralCardStatus;
}

/** 可以被 Topup 或指定 Card Charge 定位的 Card 引用。 */
export type CreditsCardReference =
  | {
      /** Primary Card 类型。 */
      kind: "primary";
      /** Primary Card 所属用户 ID。 */
      user_id: string;
    }
  | {
      /** Ephemeral Card 类型。 */
      kind: "ephemeral";
      /** Ephemeral Card 唯一 ID。 */
      card_id: string;
    };

/** 用户当前 Credits 汇总。 */
export interface CreditsSummary extends Record<string, unknown> {
  /** 用户 ID。 */
  user_id: string;
  /** Primary Card 当前余额。 */
  primary_credits: number;
  /** 所有未过期 Ephemeral Card 余额之和。 */
  ephemeral_credits: number;
  /** 当前总可用额度。 */
  available_credits: number;
  /** 最近一张仍有余额的 Ephemeral Card 到期时间。 */
  next_expiration_at: string | null;
  /** 当前仍有效且有余额的 Ephemeral Card 数量。 */
  active_ephemeral_cards: number;
}

/** 用户全部 Credits Card 的读取结果。 */
export interface CreditsCardsView extends Record<string, unknown> {
  /** 用户唯一的 Primary Card。 */
  primary: CreditsPrimaryCard;
  /** 用户的 Ephemeral Cards。 */
  ephemeral: CreditsEphemeralCard[];
}
