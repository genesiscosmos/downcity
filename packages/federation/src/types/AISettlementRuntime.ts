/**
 * AI 结算运行时内部类型。
 *
 * 这些类型只描述 AIService 与结算运行时之间的装配边界，不构成 Federation
 * 对外公开 API。
 */

import type { CityTableApi } from "../store/table-api.js";
import type { Context } from "../service/service.js";
import type { ServiceDatabaseContext } from "./database/Database.js";
import type { AICreditsBridge, AICharge } from "./AI.js";
import type { AISettlementStatus, AIUsageOutcome, AIUsageRecord } from "./AIUsage.js";

/** AI 可靠结算任务的数据库记录。 */
export interface AISettlementJobRecord extends Record<string, unknown> {
  /** 结算任务与 AI 执行共享的稳定 ID。 */
  usage_id: string;
  /** 当前结算状态。 */
  status: AISettlementStatus;
  /** 安全结算负载 JSON。 */
  payload_json: string;
  /** 已执行次数。 */
  attempt_count: number;
  /** 下一次允许领取的时间。 */
  next_attempt_at: string;
  /** 当前租约令牌。 */
  lease_token: string;
  /** 当前租约到期时间。 */
  lease_expires_at: string;
  /** 最近一次稳定错误码。 */
  last_error_code: string;
  /** 最近一次不含敏感信息的错误消息。 */
  last_error_message: string;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
  /** 完成时间；未完成时为空字符串。 */
  completed_at: string;
}

/** AI 结算运行时的构造参数。 */
export interface AISettlementRuntimeOptions {
  /** 可选 Credits 桥接，用于前置检查和最终扣费。 */
  credits?: AICreditsBridge;
}

/** Federation 初始化时注入结算运行时的持久化资源。 */
export interface AISettlementRuntimeInitialization {
  /** AI Service 可访问的受限数据库能力。 */
  database: ServiceDatabaseContext;
  /** AI 技术用量事实表。 */
  usage_records: CityTableApi<AIUsageRecord>;
  /** AI 可靠结算任务表。 */
  settlement_jobs: CityTableApi<AISettlementJobRecord>;
}

/** 一次 AI 执行交给结算运行时的完整输入。 */
export interface AISettlementExecutionInput {
  /** 当前 Action 上下文。 */
  ctx: Context;
  /** 本次模型执行的最终输出；失败时可以为空。 */
  output: unknown;
  /** 本次执行的最终业务结果。 */
  outcome: AIUsageOutcome;
  /** 本次模型执行开始的 Unix 毫秒时间。 */
  started_at: number;
  /** 已计算或异步计算的可选扣费草稿。 */
  charge?: AICharge | Promise<AICharge | undefined>;
}
