/**
 * AI 计量与可靠结算运行时。
 *
 * 本模块唯一持有 Credits Bridge 与 AIUsageRepository，负责前置余额检查、输出
 * 计量、账单输入、可靠结算、流式响应绑定和结算任务恢复。AIService 只负责在
 * 模型执行检查点调用这些能力。
 */

import { is_bureau_id } from "../../federation/identity/bureau-id.js";
import type { Context } from "../service.js";
import type { AIBillInput, AICharge, AIModelDefinition } from "../../types/AI.js";
import type {
  AdminAIUsageResult,
  AdminUsageQuery,
  AIDailyUsageResult,
  AIRecentUsageResult,
  AISettlementPayload,
  AIUsageRecord,
  UserDailyUsageQuery,
  UserRecentAIUsageQuery,
} from "../../types/AIUsage.js";
import type {
  AISettlementExecutionInput,
  AISettlementRuntimeInitialization,
  AISettlementRuntimeOptions,
} from "../../types/AISettlementRuntime.js";
import { settle_response_charge } from "./charge-runtime.js";
import {
  AIUsageRepository,
  type AISettlementProcessResult,
} from "./AIUsageRepository.js";
import {
  countImageOutputs,
  extractUsage,
  isChannelChargedOutput,
  normalizeUsage,
  readOptionalString,
  type ResolvedChannelOutput,
} from "./ai-service-values.js";

/**
 * 一次 AI 执行的计量与结算协调器。
 *
 * 实例生命周期跟随 AIService；持久化资源在 Federation 完成 Service 装配后注入。
 */
export class AISettlementRuntime {
  /** AI 专用 Credits 桥接。 */
  private readonly credits?: AISettlementRuntimeOptions["credits"];
  /** AI Usage 与可靠结算 Repository。 */
  private usage_repository?: AIUsageRepository;

  constructor(options: AISettlementRuntimeOptions = {}) {
    this.credits = options.credits;
  }

  /** 初始化 Usage Repository、查询索引并恢复少量到期任务。 */
  async initialize(input: AISettlementRuntimeInitialization): Promise<void> {
    this.usage_repository = new AIUsageRepository(
      input.database,
      input.usage_records,
      input.settlement_jobs,
      this.credits,
    );
    await input.database.query({
      sql: "CREATE INDEX IF NOT EXISTS service_ai_usage_records_user_completed_idx ON service_ai_usage_records (user_id, completed_at)",
      params: [],
    });
    await input.database.query({
      sql: "CREATE INDEX IF NOT EXISTS service_ai_usage_records_user_metering_completed_idx ON service_ai_usage_records (user_id, metering_status, completed_at)",
      params: [],
    });
    await input.database.query({
      sql: "CREATE INDEX IF NOT EXISTS service_ai_settlement_jobs_status_next_attempt_idx ON service_ai_settlement_jobs (status, next_attempt_at)",
      params: [],
    });
    await this.recover_due_settlements();
  }

  /** 对消费型 AI Action 执行 Credits 前置检查。 */
  async precheck(ctx: Context): Promise<void> {
    const user_id = ctx.user?.user_id;
    if (!user_id || !this.credits?.precheck) return;
    await this.credits.precheck(user_id);
  }

  /** 从 Action 输出提取并写入标准计量信息。 */
  attach_output_metering(
    ctx: Context,
    output: unknown,
    mode: string,
    started_at: number,
  ): void {
    const usage = extractUsage(output);
    const normalized_usage = normalizeUsage(usage);
    const image_count = mode === "image"
      ? countImageOutputs(output) || ctx.metering?.image_count
      : ctx.metering?.image_count;

    ctx.metering = {
      ...ctx.metering,
      ...normalized_usage,
      ...(image_count ? { image_count } : {}),
      duration_ms: Date.now() - started_at,
      raw_usage: usage ?? ctx.metering?.raw_usage,
    };
  }

  /** 构造模型账单函数允许读取的显式领域输入。 */
  build_bill_input(
    ctx: Context,
    model: AIModelDefinition,
    output: unknown,
  ): AIBillInput {
    return {
      usage_id: this.ensure_usage_id(ctx),
      output,
      model: {
        id: model.id,
        upstream_model: model.upstream_model,
      },
      ...(model.pricing ? { pricing: model.pricing } : {}),
      ...(ctx.metering ? { metering: ctx.metering } : {}),
      ...(ctx.user?.user_id ? { user_id: ctx.user.user_id } : {}),
      ...(ctx.bureau?.bureau_id ? { bureau_id: ctx.bureau.bureau_id } : {}),
    };
  }

  /** 拆包 AIChannel 返回的统一带计费结果。 */
  resolve_channel_output(value: unknown): ResolvedChannelOutput {
    if (isChannelChargedOutput(value)) {
      return {
        output: value.output,
        charge: value.charge,
      };
    }
    return { output: value };
  }

  /** 将一次完成的 AI 执行交给统一可靠结算入口。 */
  async settle_execution(input: AISettlementExecutionInput): Promise<void> {
    const usage_id = this.ensure_usage_id(input.ctx);
    let charge: AICharge | null = null;
    try {
      charge = (await input.charge) ?? null;
    } catch (error) {
      console.error("[AIService] billing build failed", {
        usage_id,
        model_id: input.ctx.metering?.model_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const repository = this.usage_repository;
    if (!repository) {
      // 嵌入式单元调用没有 Federation Repository 时仍保留显式 Credits bridge 语义。
      const user_id = charge?.user_id ?? input.ctx.user?.user_id;
      if (charge && charge.credits > 0 && user_id && this.credits) {
        await this.credits.charge({
          ...charge,
          user_id,
          ref: usage_id,
          idempotency_key: `ai:${usage_id}`,
          source: "model_usage",
        });
      }
      return;
    }

    const payload: AISettlementPayload = {
      record: this.create_usage_record(
        input.ctx,
        usage_id,
        input.outcome,
        input.started_at,
      ),
      charge,
    };
    try {
      await repository.create_settlement(payload);
      const result = await repository.process_settlement(usage_id);
      if (result.status === "retryable") {
        await this.enqueue_settlement_retry(input.ctx, usage_id, result.next_attempt_at);
      }
    } catch (error) {
      console.error("[AIService] settlement handoff failed", {
        usage_id,
        model_id: input.ctx.metering?.model_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 为流式响应绑定结算任务，覆盖 Node 与 Worker 请求生命周期。 */
  async bind_settlement_response(
    ctx: Context,
    response: Response,
    settlement: Promise<void>,
  ): Promise<Response> {
    if (ctx.waitUntil) {
      try {
        ctx.waitUntil(settlement);
        return response;
      } catch {
        // 测试 Runtime 可能暴露不可用的 ExecutionContext，继续使用 Response 绑定。
      }
    }
    return await settle_response_charge(response, settlement);
  }

  /** 为当前 AI 执行创建并复用 usage_id。 */
  ensure_usage_id(ctx: Context): string {
    const existing = readOptionalString(ctx.locals.ai_usage_id);
    if (existing) return existing;
    const usage_id = `aiu_${crypto.randomUUID()}`;
    ctx.locals.ai_usage_id = usage_id;
    return usage_id;
  }

  /** 处理单个可靠结算任务，并在需要时投递下一次唤醒。 */
  async process_settlement(
    ctx: Context,
    usage_id: string,
  ): Promise<AISettlementProcessResult> {
    const result = await this.require_usage_repository().process_settlement(usage_id);
    if (result.status === "retryable") {
      await this.enqueue_settlement_retry(ctx, usage_id, result.next_attempt_at);
    }
    return result;
  }

  /** 聚合指定用户的每日 AI 技术用量。 */
  async aggregate_user_daily_usage(input: UserDailyUsageQuery): Promise<AIDailyUsageResult> {
    return await this.require_usage_repository().aggregate_user_daily_usage(input);
  }

  /** 读取指定用户最近的 AI Token 用量。 */
  async list_user_recent_usage(input: UserRecentAIUsageQuery): Promise<AIRecentUsageResult> {
    return await this.require_usage_repository().list_user_recent_usage(input);
  }

  /** 按日期范围聚合 Federation 全部用户的 AI 技术用量。 */
  async aggregate_admin_usage(input: AdminUsageQuery): Promise<AdminAIUsageResult> {
    return await this.require_usage_repository().aggregate_admin_usage(input);
  }

  /** 创建最终 AI Usage Record 快照。 */
  private create_usage_record(
    ctx: Context,
    usage_id: string,
    outcome: AISettlementExecutionInput["outcome"],
    started_at: number,
  ): AIUsageRecord {
    const metering = ctx.metering;
    const settled = has_final_metering(metering);
    const completed_at = new Date().toISOString();
    return {
      usage_id,
      user_id: ctx.user?.user_id ?? readOptionalString(ctx.locals.ai_usage_user_id) ?? null,
      bureau_id: ctx.bureau?.bureau_id
        ?? (is_bureau_id(ctx.locals.ai_usage_bureau_id) ? ctx.locals.ai_usage_bureau_id : null),
      action_id: ctx.action?.id ?? "",
      model_id: metering?.model_id ?? ctx.variant?.id ?? "",
      channel_id: metering?.channel_id ?? ctx.variant?.channel_id ?? null,
      upstream_model: metering?.upstream_model ?? ctx.variant?.upstream_model ?? null,
      metering_status: settled ? "settled" : "unavailable",
      outcome,
      uncached_input_tokens: settled ? read_optional_usage_integer(metering?.input_tokens) : null,
      cached_input_tokens: settled ? read_optional_usage_integer(metering?.cached_tokens) : null,
      output_tokens: settled ? read_optional_usage_integer(metering?.output_tokens) : null,
      reasoning_tokens: settled ? read_optional_usage_integer(metering?.reasoning_tokens) : null,
      image_count: settled ? read_optional_usage_integer(metering?.image_count) : null,
      video_seconds: settled ? read_optional_usage_integer(metering?.video_seconds) : null,
      audio_seconds: settled ? read_optional_usage_integer(metering?.audio_seconds) : null,
      request_count: settled ? read_optional_usage_integer(metering?.request_count) : null,
      duration_ms: settled
        ? read_optional_usage_integer(metering?.duration_ms ?? Date.now() - started_at)
        : null,
      started_at: new Date(started_at).toISOString(),
      completed_at,
      created_at: completed_at,
    };
  }

  /** 投递结算重试；没有 Queue Adapter 时保留数据库任务等待后续恢复。 */
  private async enqueue_settlement_retry(
    ctx: Context,
    usage_id: string,
    next_attempt_at?: string,
  ): Promise<void> {
    if (!ctx.queue) return;
    const delay_ms = next_attempt_at
      ? Math.max(0, Date.parse(next_attempt_at) - Date.now())
      : undefined;
    try {
      await ctx.queue.send({
        service: "ai",
        action: "settlement/process",
        input: { usage_id },
        ...(delay_ms !== undefined ? { delay_ms } : {}),
      });
    } catch {
      // Queue 是唤醒优化；数据库任务会在启动或后续 AI 请求时恢复。
    }
  }

  /** Federation 初始化时恢复少量到期任务。 */
  private async recover_due_settlements(): Promise<void> {
    const repository = this.require_usage_repository();
    for (const usage_id of await repository.list_due_settlements()) {
      await repository.process_settlement(usage_id);
    }
  }

  /** 读取已初始化的 AI Usage Repository。 */
  private require_usage_repository(): AIUsageRepository {
    if (!this.usage_repository) throw new Error("AI Usage Repository is not initialized");
    return this.usage_repository;
  }
}

/** 判断当前 Metering 是否包含可信的最终技术用量。 */
function has_final_metering(metering: Context["metering"]): boolean {
  return Boolean(metering && [
    metering.input_tokens,
    metering.cached_tokens,
    metering.output_tokens,
    metering.reasoning_tokens,
    metering.image_count,
    metering.video_seconds,
    metering.audio_seconds,
  ].some((value) => value !== undefined));
}

/** 读取可选非负安全整数；缺失或非法值保持 null。 */
function read_optional_usage_integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
