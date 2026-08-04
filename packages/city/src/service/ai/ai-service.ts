/**
 * AI Service 模块。
 *
 * AIService 处理所有 AI 通路（SDK 通路 + OpenAI 兼容通路）。
 * 通过 action() 注册 modality action，通过 resolve() 匹配模型和 action。
 *
 * 鉴权由 City 在路由入口统一强制执行。
 *
 * 路由（City 自动生成）：
 * - POST /v1/ai/text             — 文本生成
 * - POST /v1/ai/stream           — CityModel LanguageModelV3 模型流
 * - POST /v1/ai/video            — 视频生成
 * - POST /v1/ai/image/create     — 创建图片生成任务
 * - POST /v1/ai/image/result     — 查询图片生成任务
 * - POST /v1/ai/chat/completions — OpenAI 兼容端点
 * - GET  /v1/ai/models           — 模型列表
 */

import { Service, type Context } from "../service.js";
import { httpError } from "../../utils/helpers.js";
import type { ActionFn } from "../action.js";
import { sqliteAsyncJobs } from "../async-job/schema.js";
import type { AsyncJobRecord } from "../../types/AsyncJob.js";
import type { CityModelDescriptor } from "@downcity/type";
import type {
  AICreditsBridge,
  AIBillInput,
  AICharge,
  AIImageCreateResult,
  AIImageJobContext,
  AIImageResult,
  AIModelActions,
  AIModelDefinition,
  AIResolvedAction,
  AIResolvedRoutingPlan,
  AIRoutingFallbackReason,
  AIServiceOptions,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamResult,
} from "../../types/AI.js";
import type {
  OpenAIChatCompletionRequest,
} from "../../types/AITransport.js";
import type {
  UserImageJobCreateResult,
  UserImageJobResult,
} from "../../pact/user/types.js";
import {
  attach_resolved_reasoning,
  resolve_model_reasoning,
} from "./reasoning.js";
import { AIModelRegistry } from "./model-registry.js";
import { resolve_text_routing_plan } from "./model-routing.js";
import {
  claim_image_job,
  finish_image_job_fetch,
  release_image_job_claim,
} from "./image-job-store.js";
import { settle_response_charge } from "./charge-runtime.js";
import { AIUsageRepository } from "./AIUsageRepository.js";
import { ai_settlement_jobs, ai_usage_records } from "./ai-usage-schema.js";
import type {
  AIDailyUsageResult,
  AISettlementPayload,
  AIUsageOutcome,
  AIUsageRecord,
  UserDailyUsageQuery,
} from "../../types/AIUsage.js";
import {
  create_city_language_model_stream,
  decode_city_language_model_request,
  prepare_city_language_model_call,
} from "./language-model-stream.js";
import {
  create_openai_chat_completion_response,
  openai_chat_request_to_language_model_call,
} from "./OpenAIChatCompletionsAdapter.js";
import {
  countImageOutputs,
  extractUsage,
  imageActionError,
  isImageChannelCreateResult,
  isImageChannelResult,
  isChannelChargedOutput,
  isResponse,
  isStorableRemoteFilePart,
  normalizePositiveNumber,
  normalizeUsage,
  parseImageMessage,
  parseRecordJson,
  readFilePartFilename,
  readFilePartMediaType,
  readOptionalNumber,
  readOptionalString,
  read_optional_opaque_string,
  rowToAsyncJobRecord,
  type ResolvedChannelOutput,
} from "./ai-service-values.js";

/** AIService 直接暴露的 action 模态列表。模型流与图片任务使用独立 handler。 */
const MODALITIES = ["text", "video", "tts", "asr"] as const;
/** 用户侧默认以 text 模态排序模型 */
const DEFAULT_MODEL_MODE = "text";
/** CityModel 原生 LanguageModelV3 运行模式。 */
const LANGUAGE_MODEL_MODE = "language_model";
/** 图片任务的内部 action 列表。 */
const IMAGE_ACTION_MODES = ["image_create", "image_fetch"] as const;
/** 图片生成任务在通用 async_jobs 表中的类型。 */
const IMAGE_GENERATE_JOB_TYPE = "ai.image.generate";
/** 图片任务后台抓取 action。 */
const IMAGE_FETCH_ACTION = "image/fetch";
/** 图片任务默认最长 pending 时间：2 小时。 */
const DEFAULT_IMAGE_MAX_PENDING_DURATION_MS = 2 * 60 * 60 * 1000;
/** 图片任务 pending 超时错误。 */
const IMAGE_PENDING_TIMEOUT_ERROR = "upstream timeout";

type Modality = (typeof MODALITIES)[number];
type EnvReader = (key: string) => string | undefined;

/** 判断 AIChannel runtime 是否返回了标准模型流结果。 */
function is_language_model_stream_result(value: unknown): value is LanguageModelV3StreamResult {
  if (!value || typeof value !== "object") return false;
  const stream = (value as { stream?: unknown }).stream;
  return Boolean(stream && typeof stream === "object" && "getReader" in stream &&
    typeof (stream as { getReader?: unknown }).getReader === "function");
}


export class AIService extends Service {
  /** 模型注册表 */
  private readonly models = new AIModelRegistry();

  /** SDK 通路 action 映射（modality → action） */
  private modalityActions = new Map<string, ActionFn>();

  /** AI 专用 Credits 桥接。 */
  private readonly credits?: AICreditsBridge;
  /** 图片异步任务允许保持 queued/running 的最长时间。 */
  private readonly image_max_pending_duration_ms: number;
  /** AI Usage 与可靠结算 Repository。 */
  private usage_repository?: AIUsageRepository;

  constructor(options: AIServiceOptions = {}) {
    super({
      id: "ai",
      name: "AI",
      tables: {
        async_jobs: sqliteAsyncJobs,
        usage_records: ai_usage_records,
        settlement_jobs: ai_settlement_jobs,
      },
    });
    this.credits = options.credits;
    this.image_max_pending_duration_ms = normalizePositiveNumber(
      options.image_max_pending_duration_ms,
      DEFAULT_IMAGE_MAX_PENDING_DURATION_MS,
    );

    // 为每个 modality 注册 routing action
    for (const modality of MODALITIES) {
      this.action(modality, async (ctx) => this.handleModality(modality, ctx), {
        auth: ["user", "admin"],
      }).before((ctx) => this.precheck(ctx));
    }

    // `/stream` 是 CityModel 唯一模型流入口，不经过旧 UIMessage action。
    this.action("stream", async (ctx) => this.handleLanguageModelStream(ctx), {
      auth: ["user", "admin"],
    }).before((ctx) => this.precheck(ctx));

    // 图片生成的任务式端点。SDK 通过 image_create / image_result 显式访问。
    this.action("image/create", async (ctx) => this.createImageJob(ctx), {
      auth: ["user", "admin"],
    }).before((ctx) => this.precheck(ctx));
    this.action("image/result", async (ctx) => this.readImageJob(ctx), {
      auth: ["user", "admin"],
    });
    this.action(IMAGE_FETCH_ACTION, async (ctx) => this.fetchImageJob(ctx), {
      auth: ["admin"],
    });

    // OpenAI 兼容端点
    this.action("chat/completions", async (ctx) => this.handleChatCompletions(ctx), {
      auth: ["user", "admin"],
    }).before((ctx) => this.precheck(ctx));

    // Queue 只负责唤醒；数据库 Settlement Job 才是可靠结算事实源。
    this.action("settlement/process", async (ctx) => {
      const usage_id = readOptionalString(ctx.input.usage_id);
      if (!usage_id) throw httpError(422, "usage_id is required");
      const result = await this.require_usage_repository().process_settlement(usage_id);
      if (result.status === "retryable") {
        await this.enqueue_settlement_retry(ctx, usage_id, result.next_attempt_at);
      }
      return result;
    }, { auth: ["admin"] });

    // 模型列表走同一路径，根据身份决定可见范围。
    this.action("models", (ctx) => ({
      items: AIService.listModels(this, {
        env: ctx.env,
        identity: ctx.identity?.kind ?? "guest",
      }),
    }), { method: "GET", auth: ["user", "admin"] });
  }

  // ========== 模型注册 ==========

  use(...inputs: (AIModelDefinition | AIModelDefinition[])[]): this {
    this.models.register(...inputs);
    return this;
  }

  listModels(): AIModelDefinition[] {
    return this.models.list();
  }

  hasAction(): boolean {
    return this.models.size > 0;
  }

  /** 初始化 AI Usage Repository 与查询索引。 */
  protected override async on_init(): Promise<void> {
    const database = this.require_service_database();
    this.usage_repository = new AIUsageRepository(
      database,
      this.require_service_table<AIUsageRecord>("usage_records"),
      this.require_service_table("settlement_jobs"),
      this.credits,
    );
    await database.query({
      sql: "CREATE INDEX IF NOT EXISTS service_ai_usage_records_user_completed_idx ON service_ai_usage_records (user_id, completed_at)",
      params: [],
    });
    await database.query({
      sql: "CREATE INDEX IF NOT EXISTS service_ai_usage_records_user_metering_completed_idx ON service_ai_usage_records (user_id, metering_status, completed_at)",
      params: [],
    });
    await database.query({
      sql: "CREATE INDEX IF NOT EXISTS service_ai_settlement_jobs_status_next_attempt_idx ON service_ai_settlement_jobs (status, next_attempt_at)",
      params: [],
    });
    await this.recover_due_settlements();
  }

  /** UsageService 使用的 AI 技术用量只读入口。 */
  async aggregate_user_daily_usage(input: UserDailyUsageQuery): Promise<AIDailyUsageResult> {
    return await this.require_usage_repository().aggregate_user_daily_usage(input);
  }

  // ========== 模型匹配 ==========

  resolve(query: { model?: string; mode?: string }, env?: EnvReader): { model?: AIModelDefinition; action: ActionFn } {
    const { model: modelId, mode } = query;

    if (!modelId) throw httpError(422, "model is required");

    const model = this.models.get(modelId);
    if (!model) throw httpError(422, `Unknown model: ${modelId}`);
    if (env && this.models.get_missing_env(model, env).length > 0) {
      throw httpError(422, `No available model: ${modelId}`);
    }
    const action = this.getAction(model, mode);
    if (!action) throw httpError(422, `Model ${modelId} does not support mode: ${mode ?? "text"}`);
    return { model, action };
  }

  private normalizeModelId(input: unknown): string | undefined {
    const model_id = typeof input === "string" ? input.trim() : "";
    return model_id || undefined;
  }

  private getAction(model: AIModelDefinition, mode?: string): ActionFn | undefined {
    if (mode === LANGUAGE_MODEL_MODE) {
      return model.runtime.stream
        ? (ctx) => model.runtime.stream?.(
            ctx,
            ctx.input.call as LanguageModelV3CallOptions,
          )
        : undefined;
    }
    if (mode === "image" || IMAGE_ACTION_MODES.includes(mode as (typeof IMAGE_ACTION_MODES)[number])) {
      const has_image_actions = Boolean(model.runtime.actions.image_create && model.runtime.actions.image_fetch);
      if (!has_image_actions) return undefined;
      return mode === "image"
        ? model.runtime.actions.image_create
        : model.runtime.actions[mode as keyof AIModelActions];
    }
    return model.runtime.actions[(mode ?? "text") as keyof AIModelActions];
  }

  private getModelModalities(model: AIModelDefinition): string[] {
    const modalities = Object.keys(model.runtime.actions)
      .filter((key) => model.runtime.actions[key] !== undefined);
    if (model.runtime.stream && !modalities.includes("stream")) modalities.push("stream");
    if (modalities.includes("image_create") && modalities.includes("image_fetch")) {
      modalities.push("image");
    }
    return modalities.filter((mode) => mode !== "image_create" && mode !== "image_fetch" && mode !== "image_result");
  }

  /** 按媒体输入解析最终模型，推理强度必须在该步骤之后解析。 */
  private plan_text_execution(
    resolved: AIResolvedAction,
    ctx: Context,
    mode: string,
  ): AIResolvedRoutingPlan {
    return resolve_text_routing_plan(resolved, ctx.input, mode, {
      resolve_model: (input) => this.models.get(input),
      resolve_action: (model, target_mode) => this.getAction(model, target_mode),
      is_available: (model) => this.models.get_missing_env(model, ctx.env).length === 0,
    });
  }

  // ========== SDK 通路 ==========

  private async handleModality(modality: Modality, ctx: Context): Promise<unknown | Response> {
    const initial_resolved = this.resolve({ model: this.normalizeModelId(ctx.input.model), mode: modality }, ctx.env);
    const { resolved, fallback_from, fallback_reason, fallback_media_type } = this.plan_text_execution(initial_resolved, ctx, modality);
    const reasoning = resolved.model && modality === "text"
      ? resolve_model_reasoning(resolved.model, ctx.input)
      : undefined;
    this.attachResolvedModel(ctx, resolved.model, modality, { fallback_from, fallback_reason, fallback_media_type });
    attach_resolved_reasoning(ctx, reasoning);
    const started_at = Date.now();
    this.ensure_usage_id(ctx);

    try {
      const channel_output = await resolved.action(ctx);
      const { output, charge } = this.resolveChannelOutput(channel_output);
      this.attachOutputMetering(ctx, output, modality, started_at);
      const resolved_charge = charge ?? (resolved.model
        ? resolved.model.bill?.(this.build_bill_input(ctx, resolved.model, output))
        : undefined);
      const settlement = this.settle_execution({
        ctx,
        output,
        outcome: "succeeded",
        started_at,
        charge: resolved_charge,
      });
      if (isResponse(output)) return await this.bind_settlement_response(ctx, output, settlement);
      await settlement;
      return output;
    } catch (error) {
      await this.settle_execution({
        ctx,
        output: undefined,
        outcome: "failed",
        started_at,
      });
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
    }
  }

  /**
   * 执行 CityModel LanguageModelV3 模型流调用。
   *
   * 路由、fallback、reasoning 和计费仍由 AIService 统一拥有；AIChannel 负责执行
   * 标准模型流，transport 模块只编码 SSE，避免把 Channel 决策泄漏到客户端。
   */
  private async handleLanguageModelStream(ctx: Context): Promise<Response> {
    const request = decode_city_language_model_request(ctx.input);
    const call = prepare_city_language_model_call(request.call, ctx.request?.signal);
    ctx.input = {
      ...ctx.input,
      model: request.model_id,
      call,
      ...(request.reasoning_effort ? { reasoning_effort: request.reasoning_effort } : {}),
    };
    const initial_resolved = this.resolve({ model: request.model_id, mode: LANGUAGE_MODEL_MODE }, ctx.env);
    const routing = this.plan_text_execution(initial_resolved, ctx, LANGUAGE_MODEL_MODE);
    const resolved = routing.resolved;
    const reasoning = resolved.model ? resolve_model_reasoning(resolved.model, ctx.input) : undefined;
    this.attachResolvedModel(ctx, resolved.model, LANGUAGE_MODEL_MODE, routing);
    attach_resolved_reasoning(ctx, reasoning);
    const started_at = Date.now();
    this.ensure_usage_id(ctx);

    const output = await resolved.action(ctx);
    if (!is_language_model_stream_result(output)) {
      throw httpError(500, "AIChannel stream did not return a LanguageModelV3 stream result");
    }
    const execution = create_city_language_model_stream({
      result: output,
    });
    const settlement = execution.completion.then(async (completion) => {
      const part = completion.result;
      if (part) this.attachOutputMetering(ctx, part, LANGUAGE_MODEL_MODE, started_at);
      const charge = part && resolved.model?.bill
        ? resolved.model.bill(this.build_bill_input(ctx, resolved.model, part))
        : undefined;
      await this.settle_execution({
        ctx,
        output: part,
        outcome: completion.outcome,
        started_at,
        charge,
      });
    });
    return await this.bind_settlement_response(ctx, execution.response, settlement);
  }

  // ========== 图片任务通路 ==========

  private async createImageJob(ctx: Context): Promise<UserImageJobCreateResult> {
    const resolved = this.resolve({ model: this.normalizeModelId(ctx.input.model), mode: "image_create" }, ctx.env);
    this.attachResolvedModel(ctx, resolved.model, "image/create");
    const started_at = Date.now();
    this.ensure_usage_id(ctx);
    try {
      const created = await resolved.action(ctx);
      if (!isImageChannelCreateResult(created)) {
        throw httpError(500, "image_create action returned invalid result");
      }
      await this.insertImageJob(ctx, created);
      await this.enqueueImageFetch(ctx, created.job_id, created.poll_after_ms);
      return created;
    } catch (error) {
      await this.settle_execution({
        ctx,
        output: undefined,
        outcome: "failed",
        started_at,
      });
      throw imageActionError(error, "image_create action failed");
    }
  }

  private async readImageJob(ctx: Context): Promise<UserImageJobResult> {
    const job = await this.requireImageJob(ctx);
    try {
      return this.imageJobToResult(job);
    } catch (error) {
      throw imageActionError(error, "image_result action failed");
    }
  }

  /**
   * 后台抓取图片任务状态，并根据结果更新 async_jobs。
   */
  private async fetchImageJob(ctx: Context): Promise<AIImageResult> {
    let claim: Awaited<ReturnType<typeof claim_image_job>> = null;
    const initial_job = await this.requireImageJob(ctx);
    const initial_state = parseRecordJson(initial_job.state_json);
    ctx.locals.ai_usage_id = readOptionalString(initial_state.downcity_usage_id)
      ?? `aiu_image_${initial_job.job_id}`;
    ctx.locals.ai_usage_user_id = initial_job.user_id;
    ctx.locals.ai_usage_bureau_id = initial_job.bureau_id;
    try {
      if (this.isTerminalImageJob(initial_job)) return this.imageJobToResult(initial_job);
      const table = ctx.db.async_jobs;
      if (!table) throw httpError(500, "AI async_jobs table is not initialized");
      claim = await claim_image_job(table, initial_job);
      if (!claim) return this.imageJobToResult(await this.requireImageJob(ctx));
      const job = claim.record;
      if (this.isImageJobPendingTimedOut(job)) {
        const output = this.createImageJobPendingTimeoutResult(job);
        await this.settle_execution({
          ctx,
          output,
          outcome: "failed",
          started_at: Date.parse(job.created_at),
        });
        await finish_image_job_fetch(table, claim, output);
        return output;
      }

      const model_id = job.model_id ?? readOptionalString(ctx.input.model);
      if (!model_id) throw httpError(422, "Image job is missing model_id");
      const model = this.models.get(model_id);
      if (!model?.runtime.actions.image_fetch) {
        throw httpError(422, `No image_fetch action for model: ${model_id}`);
      }

      this.attachResolvedModel(ctx, model, IMAGE_FETCH_ACTION);
      this.attachImageJobContext(ctx, job);
      const started_at = Date.now();
      const output = await model.runtime.actions.image_fetch(ctx);
      if (!isImageChannelResult(output)) {
        throw httpError(500, "image_fetch action returned invalid result");
      }
      const stored_output = await this.normalizeImageResultStorage(ctx, output);
      const should_charge = output.status === "succeeded" && Boolean(output.result) && !job.result_json;
      if (should_charge) {
        this.attachOutputMetering(ctx, stored_output.result, "image", started_at);
        const charge = Promise.resolve(model.bill?.(this.build_bill_input(ctx, model, stored_output)))
          .then((line) => line ? { ...line, user_id: line.user_id ?? job.user_id ?? undefined } : undefined);
        await this.settle_execution({
          ctx,
          output: stored_output,
          outcome: "succeeded",
          started_at: Date.parse(job.created_at),
          charge,
        });
      } else if (stored_output.status === "failed") {
        await this.settle_execution({
          ctx,
          output: stored_output,
          outcome: "failed",
          started_at: Date.parse(job.created_at),
        });
      }
      await finish_image_job_fetch(table, claim, stored_output);
      if (stored_output.status === "queued" || stored_output.status === "running") {
        await this.enqueueImageFetch(ctx, job.job_id, stored_output.poll_after_ms);
      }
      return stored_output;
    } catch (error) {
      const table = ctx.db.async_jobs;
      if (table && claim) await release_image_job_claim(table, claim);
      throw imageActionError(error, "image_fetch action failed");
    }
  }

  /**
   * 判断图片任务是否已经进入本地终态。
   */
  private isTerminalImageJob(job: AsyncJobRecord): boolean {
    return Boolean((job.status === "succeeded" && job.result_json) || job.status === "failed");
  }

  /**
   * 判断图片任务是否超过平台允许的 pending 时间。
   */
  private isImageJobPendingTimedOut(job: AsyncJobRecord): boolean {
    if (job.status !== "queued" && job.status !== "running" && job.status !== "fetching") return false;
    const created_at = Date.parse(job.created_at);
    if (!Number.isFinite(created_at)) return false;
    return Date.now() - created_at >= this.image_max_pending_duration_ms;
  }

  /**
   * 构造 pending 超时后的统一失败结果。
   */
  private createImageJobPendingTimeoutResult(job: AsyncJobRecord): AIImageResult {
    return {
      job_id: job.job_id,
      status: "failed",
      message: IMAGE_PENDING_TIMEOUT_ERROR,
      error: IMAGE_PENDING_TIMEOUT_ERROR,
      metadata: {
        ...this.read_image_job_state(job),
        timeout_reason: IMAGE_PENDING_TIMEOUT_ERROR,
        max_pending_duration_ms: this.image_max_pending_duration_ms,
      },
    };
  }

  /**
   * 调度下一次图片任务抓取。
   */
  private async enqueueImageFetch(ctx: Context, job_id: string, delay_ms?: number): Promise<void> {
    if (!ctx.queue) return;
    await ctx.queue.send({
      service: "ai",
      action: IMAGE_FETCH_ACTION,
      input: { job_id },
      delay_ms,
    });
  }

  /**
   * 将图片结果里的外部 file URL 归一到 Federation 默认存储。
   *
   * 关键说明（中文）
   * - 只处理 succeeded 结果，queued/running/failed 保持原样。
   * - 已经属于当前 storage 的 URL 直接跳过，避免重复转存。
   * - 转存失败时保留源地址，不影响图片任务成功写入。
   */
  private async normalizeImageResultStorage(
    ctx: Context,
    output: AIImageResult,
  ): Promise<AIImageResult> {
    if (!ctx.storage || output.status !== "succeeded" || !output.result) return output;
    const result = output.result as { parts?: unknown[] };
    if (!Array.isArray(result.parts)) return output;

    let changed = false;
    const next_parts: unknown[] = [];
    for (const part of result.parts) {
      if (!isStorableRemoteFilePart(part)) {
        next_parts.push(part);
        continue;
      }

      const source_url = part.url;
      if (ctx.storage.owns(source_url)) {
        next_parts.push(part);
        continue;
      }

      try {
        const stored = await ctx.storage.store({
          source_url,
          media_type: readFilePartMediaType(part),
          filename: readFilePartFilename(part),
        });
        const stored_url = readOptionalString(stored.url);
        if (!stored_url) {
          next_parts.push(part);
          continue;
        }
        next_parts.push({
          ...part,
          url: stored_url,
        });
        changed = true;
      } catch (error) {
        console.warn(
          `[AIService] storage store failed, keeping source url :: ${error instanceof Error ? error.message : String(error)} :: url=${source_url}`,
        );
        next_parts.push(part);
      }
    }

    if (!changed) return output;
    return {
      ...output,
      result: {
        ...output.result,
        parts: next_parts as typeof output.result.parts,
      },
    };
  }

  /**
   * 写入图片任务。
   */
  private async insertImageJob(ctx: Context, created: AIImageCreateResult): Promise<void> {
    const table = ctx.db.async_jobs;
    if (!table) throw httpError(500, "AI async_jobs table is not initialized");
    const now = new Date().toISOString();
    await table.insert({
      job_id: created.job_id,
      job_type: IMAGE_GENERATE_JOB_TYPE,
      status: created.status,
      input_json: JSON.stringify(ctx.input ?? {}),
      state_json: JSON.stringify({
        ...(created.metadata ?? {}),
        downcity_usage_id: this.ensure_usage_id(ctx),
      }),
      result_json: null,
      error: created.error ?? null,
      message: created.message ?? null,
      poll_after_ms: created.poll_after_ms ? String(created.poll_after_ms) : null,
      bureau_id: ctx.bureau?.bureau_id ?? null,
      user_id: ctx.user?.user_id ?? null,
      service_id: "ai",
      model_id: ctx.metering?.model_id ?? null,
      created_at: now,
      updated_at: now,
    });
  }

  /**
   * 读取图片任务。
   */
  private async requireImageJob(ctx: Context): Promise<AsyncJobRecord> {
    const table = ctx.db.async_jobs;
    if (!table) throw httpError(500, "AI async_jobs table is not initialized");
    const job_id = readOptionalString(ctx.input.job_id);
    if (!job_id) throw httpError(422, "job_id is required");
    const rows = await table.select({ job_id, job_type: IMAGE_GENERATE_JOB_TYPE });
    const row = rows[0];
    if (!row) throw httpError(404, `Image job not found: ${job_id}`);
    return rowToAsyncJobRecord(row);
  }

  /**
   * 把 async_jobs 记录注入 AIChannel 可读取的上下文。
   */
  private attachImageJobContext(ctx: Context, job: AsyncJobRecord): void {
    const image_job: AIImageJobContext = {
      record: job,
      input: parseRecordJson(job.input_json),
      state: this.read_image_job_state(job),
    };
    ctx.locals.ai_image_job = image_job;
    ctx.input = {
      ...parseRecordJson(job.input_json),
      ...ctx.input,
      job_id: job.job_id,
    };
  }

  /**
   * 将图片任务记录转成默认 result 返回。
   */
  private imageJobToResult(job: AsyncJobRecord): AIImageResult {
    return {
      job_id: job.job_id,
      status: job.status === "fetching" ? "running" : job.status,
      result: job.status === "succeeded" ? parseImageMessage(job.result_json) : undefined,
      error: job.error ?? undefined,
      message: job.message ?? undefined,
      poll_after_ms: readOptionalNumber(job.poll_after_ms),
      metadata: this.read_image_job_state(job),
    };
  }

  /** 读取不会向 Provider 或客户端泄漏内部 usage_id 的图片任务状态。 */
  private read_image_job_state(job: AsyncJobRecord): Record<string, unknown> {
    const state = parseRecordJson(job.state_json);
    const { downcity_usage_id: _usage_id, ...public_state } = state;
    return public_state;
  }

  // ========== OpenAI 兼容通路 ==========

  private async handleChatCompletions(ctx: Context): Promise<Response> {
    try {
      const body = ctx.input as unknown as OpenAIChatCompletionRequest;
      const model_id = this.normalizeModelId(body.model);
      const call = openai_chat_request_to_language_model_call(body, ctx.request?.signal);
      ctx.input = {
        ...body,
        model: model_id,
        call,
      };
      const initial_resolved = this.resolve({ model: model_id, mode: LANGUAGE_MODEL_MODE }, ctx.env);
      const routing = this.plan_text_execution(initial_resolved, ctx, LANGUAGE_MODEL_MODE);
      const resolved = routing.resolved;
      const reasoning = resolved.model
        ? resolve_model_reasoning(resolved.model, body)
        : undefined;
      this.attachResolvedModel(ctx, resolved.model, "openai", routing);
      attach_resolved_reasoning(ctx, reasoning);
      const started_at = Date.now();
      this.ensure_usage_id(ctx);

      const output = await resolved.action(ctx);
      if (!is_language_model_stream_result(output)) {
        throw httpError(500, "AIChannel stream did not return a LanguageModelV3 stream result");
      }
      const execution = await create_openai_chat_completion_response({
        model_id: resolved.model?.id ?? model_id ?? "",
        stream: body.stream === true,
        result: output as LanguageModelV3StreamResult,
      });
      const settlement = execution.completion.then(async (completion) => {
        const result = completion.result;
        if (result) this.attachOutputMetering(ctx, result, "openai", started_at);
        const charge = result && resolved.model?.bill
          ? resolved.model.bill(this.build_bill_input(ctx, resolved.model, result))
          : undefined;
        await this.settle_execution({
          ctx,
          output: result,
          outcome: completion.outcome,
          started_at,
          charge,
        });
      });
      return await this.bind_settlement_response(ctx, execution.response, settlement);
    } catch (error) {
      if (ctx.locals.ai_usage_id) {
        await this.settle_execution({
          ctx,
          output: undefined,
          outcome: "failed",
          started_at: ctx.started_at?.getTime() ?? Date.now(),
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      return new Response(JSON.stringify({ error: { message, type: "server_error" } }), { status, headers: { "content-type": "application/json" } });
    }
  }

  /**
   * 将解析出的模型写回原始 Context，供 hook / usage / charge 读取。
   */
  private attachResolvedModel(
    ctx: Context,
    model: AIModelDefinition | undefined,
    mode: string,
    routing?: { fallback_from?: string; fallback_reason?: AIRoutingFallbackReason; fallback_media_type?: string },
  ): void {
    if (!model) return;
    ctx.variant = {
      id: model.id,
      name: model.name,
      meta: model.meta,
      upstream_model: model.upstream_model,
      channel_id: model.channel_id,
    };
    ctx.metering = {
      ...ctx.metering,
      channel_id: model.channel_id,
      model_id: model.id,
      upstream_model: model.upstream_model,
      request_count: ctx.metering?.request_count ?? 1,
      metadata: {
        ...(ctx.metering?.metadata ?? {}),
        mode,
        ...(routing?.fallback_from ? { fallback_from: routing.fallback_from } : {}),
        ...(routing?.fallback_reason ? { fallback_reason: routing.fallback_reason } : {}),
        ...(routing?.fallback_media_type ? { fallback_media_type: routing.fallback_media_type } : {}),
      },
    };
  }

  /**
   * AI 消费型 Action 的 Credits 前置检查。
   *
   * 关键说明（中文）
   * - 默认要求用户至少有一个可用 Credit，适配 AI 后置 usage 扣费
   * - admin 或没有用户归属的调用不产生用户扣费，也不做用户 Credits 检查
   * - image/result、image/fetch、models 等非消费型 Action 不挂载该 hook
   */
  private async precheck(ctx: Context): Promise<void> {
    const user_id = ctx.user?.user_id;
    if (!user_id || !this.credits?.precheck) return;
    await this.credits.precheck(user_id);
  }

  /**
   * 从 action 输出里提取标准计量信息。
   */
  private attachOutputMetering(ctx: Context, output: unknown, mode: string, started_at: number): void {
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

  /** 构造账单函数允许访问的显式领域输入。 */
  private build_bill_input(
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
      ...(ctx.metering ? { metering: ctx.metering } : {}),
      ...(ctx.user?.user_id ? { user_id: ctx.user.user_id } : {}),
      ...(ctx.bureau?.bureau_id ? { bureau_id: ctx.bureau.bureau_id } : {}),
    };
  }

  /**
   * 拆包 AIChannel 返回值。
   *
   * 关键说明（中文）
   * - Channel 可以返回统一的 `{ output, charge }`。
   * - 普通 action 也可以直接返回 UIMessage / Response。
   */
  private resolveChannelOutput(value: unknown): ResolvedChannelOutput {
    if (isChannelChargedOutput(value)) {
      return {
        output: value.output,
        charge: value.charge,
      };
    }
    return { output: value };
  }

  /**
   * 把一次完成的 AI 执行交给统一可靠结算入口。
   *
   * 关键说明（中文）
   * - 先持久化 Settlement Job，再保存 Usage 和执行 Charge
   * - 结算失败不覆盖已经成功生成的模型响应
   * - Charge Draft 在此处固化，重试时不重新执行价格规则
   */
  private async settle_execution(input: {
    ctx: Context;
    output: unknown;
    outcome: AIUsageOutcome;
    started_at: number;
    charge?: AICharge | Promise<AICharge | undefined>;
  }): Promise<void> {
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
      if (result.status === "retryable") await this.enqueue_settlement_retry(input.ctx, usage_id, result.next_attempt_at);
    } catch (error) {
      console.error("[AIService] settlement handoff failed", {
        usage_id,
        model_id: input.ctx.metering?.model_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 为流式响应绑定结算任务，保证 Node 与 Worker 都覆盖请求生命周期。 */
  private async bind_settlement_response(
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

  /** 创建最终 AI Usage Record 快照。 */
  private create_usage_record(
    ctx: Context,
    usage_id: string,
    outcome: AIUsageOutcome,
    started_at: number,
  ): AIUsageRecord {
    const metering = ctx.metering;
    const settled = has_final_metering(metering);
    const completed_at = new Date().toISOString();
    return {
      usage_id,
      user_id: ctx.user?.user_id ?? readOptionalString(ctx.locals.ai_usage_user_id) ?? null,
      bureau_id: ctx.bureau?.bureau_id
        ?? read_optional_opaque_string(ctx.locals.ai_usage_bureau_id)
        ?? null,
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

  /** 为当前 AI 执行创建并复用 usage_id。 */
  private ensure_usage_id(ctx: Context): string {
    const existing = readOptionalString(ctx.locals.ai_usage_id);
    if (existing) return existing;
    const usage_id = `aiu_${crypto.randomUUID()}`;
    ctx.locals.ai_usage_id = usage_id;
    return usage_id;
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

  /** Federation 初始化时恢复少量到期任务，避免 Node 重启后永久遗留。 */
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

  // ========== 模型列表 ==========

  static listModels(aiService: AIService, options: {
    env: EnvReader;
    identity: "guest" | "user" | "bureau" | "admin";
  }): CityModelDescriptor[] {
    return aiService.models.list_public({
      ...options,
      get_modalities: (model) => aiService.getModelModalities(model),
    });
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
