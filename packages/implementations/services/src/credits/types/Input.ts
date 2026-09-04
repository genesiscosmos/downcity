/**
 * Credits 写操作输入类型。
 */

import type { CreditsCardReference } from "./Card.js";

/** 创建限时 Credits Card 的输入。 */
export interface CreditsEphemeralCardCreateInput {
  /** Card 所属用户 ID。 */
  user_id: string;
  /** 面向用户展示的 Card 名称。 */
  name: string;
  /** 创建时写入的正数初始额度。 */
  initial_credits: number;
  /** Card 到期时间，必须晚于当前时间。 */
  expires_at: string;
  /** Card 创建来源。 */
  source: string;
  /** 外部活动或业务记录 ID。 */
  ref?: string;
  /** 创建 Card 与初始 Topup 共用的稳定幂等键。 */
  idempotency_key: string;
  /** 面向审计的说明。 */
  note?: string;
  /** 结构化审计信息。 */
  metadata?: Record<string, unknown>;
}

/** 给指定 Credits Card 增加额度的输入。 */
export interface CreditsTopupInput {
  /** 接收额度的 Card。 */
  card: CreditsCardReference;
  /** 增加的额度，单位为 credits。 */
  credits: number;
  /** Topup 来源。 */
  source: string;
  /** 支付、活动或业务记录 ID。 */
  ref?: string;
  /** 本次 Topup 的稳定幂等键。 */
  idempotency_key: string;
  /** 面向用户与审计的说明。 */
  note?: string;
  /** 结构化审计信息。 */
  metadata?: Record<string, unknown>;
}

/** 消费用户 Credits 的输入。 */
export interface CreditsChargeInput {
  /** 被扣费用户 ID。 */
  user_id: string;
  /** 本次消费额度，单位为 credits。 */
  credits: number;
  /** 可选指定 Card；为空时由服务自动选择。 */
  card?: CreditsCardReference;
  /** 本次 Charge 的稳定幂等键。 */
  idempotency_key: string;
  /** Charge 来源。 */
  source: string;
  /** 模型调用、任务或订单 ID。 */
  ref?: string;
  /** 面向用户与审计的说明。 */
  note?: string;
  /** 模型与真实用量等结构化审计信息。 */
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

/** Credits 用户查询条件。 */
export interface CreditsUserQuery {
  /** 返回条数上限。 */
  limit?: number | string;
}
