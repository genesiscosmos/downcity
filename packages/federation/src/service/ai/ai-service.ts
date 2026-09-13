/**
 * AI Service 模块。
 *
 * AIService 处理所有 AI 通路（SDK 通路 + OpenAI 兼容通路）。
 * 通过 action() 注册 modality action，通过 resolve() 匹配模型和 action。
 *
 * 鉴权由 City 在路由入口统一强制执行。
 *
 * 路由（City 自动生成）：
 * - POST /v1/ai/stream           — Downcity Model Protocol 模型流
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
import type { CityModelDescriptor, ModelCall } from "@downcity/type";
import type {
  AIChannelStreamResult,
  AIModelActions,
  AIModelDefinition,
  AIResolvedAction,
  AIResolvedRoutingPlan,
  AIRoutingFallbackReason,
  AIServiceOptions,
} from "../../types/AI.js";
import type {
  OpenAIChatCompletionRequest,
} from "../../types/AITransport.js";
import {
  attach_resolved_reasoning,
  resolve_model_reasoning,
} from "./reasoning.js";
import { AIModelRegistry } from "./model-registry.js";
import {
  project_model_call_for_execution,
  resolve_text_routing_plan,
} from "./model-routing.js";
import { ai_settlement_jobs, ai_usage_records } from "./ai-usage-schema.js";
import type {
  AdminAIUsageResult,
  AdminUsageQuery,
  AIDailyUsageResult,
  AIRecentUsageResult,
  AIUsageRecord,
  UserDailyUsageQuery,
  UserRecentAIUsageQuery,
} from "../../types/AIUsage.js";
import type { AISettlementJobRecord } from "../../types/AISettlementRuntime.js";
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
  isResponse,
  readOptionalString,
} from "./ai-service-values.js";
import {
  AIImageJobRuntime,
  IMAGE_ACTION_MODES,
  IMAGE_FETCH_ACTION,
} from "./AIImageJobRuntime.js";
import { AISettlementRuntime } from "./AISettlementRuntime.js";
import { AIJobReconciler, JOB_RESUME_ACTION } from "./AIJobReconciler.js";

/** AIService 直接暴露的 action 模态列表。模型流与图片任务使用独立 handler。 */
const MODALITIES = ["video", "tts", "asr"] as const;
/** 用户侧默认以 text 模态排序模型 */
const DEFAULT_MODEL_MODE = "text";
/** Downcity Model Protocol 原生运行模式。 */
const LANGUAGE_MODEL_MODE = "language_model";
type Modality = (typeof MODALITIES)[number];
type EnvReader = (key: string) => string | undefined;

/** 判断 AIChannel runtime 是否返回了标准模型流结果。 */
function is_language_model_stream_result(value: unknown): value is AIChannelStreamResult {
  if (!value || typeof value !== "object") return false;
  const stream = (value as { stream?: unknown }).stream;
  return Boolean(stream && typeof stream === "object" && "getReader" in stream &&
    typeof (stream as { getReader?: unknown }).getReader === "function");
}


export class AIService extends Service {
  /** 模型注册表 */
  private readonly models = new AIModelRegistry();

  /** AI 计量与可靠结算运行时。 */
  private readonly settlement_runtime: AISettlementRuntime;
  /** AI 图片异步任务运行时。 */
  private readonly image_runtime: AIImageJobRuntime;
  /** AI 异步任务恢复协调器。 */
  private readonly job_reconciler: AIJobReconciler;

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
    this.settlement_runtime = new AISettlementRuntime({ credits: options.credits });
    this.image_runtime = new AIImageJobRuntime({
      image_max_pending_duration_ms: options.image_max_pending_duration_ms,
      resolve_action: (query, env) => this.resolve(query, env),
      resolve_model: (model_id) => this.models.get(model_id),
      attach_resolved_model: (ctx, model, mode) => this.attachResolvedModel(ctx, model, mode),
    }, this.settlement_runtime);
    this.job_reconciler = new AIJobReconciler({
      get_queue: () => this._queue,
      resume_stalled_image_jobs: (ctx, options) =>
        this.image_runtime.resume_stalled_jobs(ctx, options),
      recover_due_settlements: (limit) => this.settlement_runtime.recover_due_settlements(limit),
    }, { interval_ms: options.reconcile_interval_ms });

    // 为每个 modality 注册 routing action
    for (const modality of MODALITIES) {
      this.action(modality, async (ctx) => this.handleModality(modality, ctx), {
        auth: ["user", "admin"],
      }).before((ctx) => this.settlement_runtime.precheck(ctx));
    }

    // `/stream` 是 CityModel 唯一模型流入口，不经过旧 UIMessage action。
    this.action("stream", async (ctx) => this.handleLanguageModelStream(ctx), {
      auth: ["user", "admin"],
    }).before((ctx) => this.settlement_runtime.precheck(ctx));

    // 图片生成的任务式端点。SDK 通过 image_create / image_result 显式访问。
    this.action("image/create", async (ctx) => this.image_runtime.create_job(ctx), {
      auth: ["user", "admin"],
    }).before((ctx) => this.settlement_runtime.precheck(ctx));
    this.action("image/result", async (ctx) => this.image_runtime.read_job(ctx), {
      auth: ["user", "admin"],
    });
    this.action(IMAGE_FETCH_ACTION, async (ctx) => this.image_runtime.fetch_job(ctx), {
      auth: ["admin"],
    });

    // OpenAI 兼容端点
    this.action("chat/completions", async (ctx) => this.handleChatCompletions(ctx), {
      auth: ["user", "admin"],
    }).before((ctx) => this.settlement_runtime.precheck(ctx));

    // Queue 只负责唤醒；数据库 Settlement Job 才是可靠结算事实源。
    this.action("settlement/process", async (ctx) => {
      const usage_id = readOptionalString(ctx.input.usage_id);
      if (!usage_id) throw httpError(422, "usage_id is required");
      return await this.settlement_runtime.process_settlement(ctx, usage_id);
    }, { auth: ["admin"] });

    // 事实源驱动的恢复：停滞的图片任务重新入队，到期的结算任务重新推进。
    // `loop` 由调用方决定是否续排：SDK 自驱动与部署侧 cron / scheduled handler
    // 复用同一个动作，因此不需要在服务里再写一套调度分支。
    this.action(JOB_RESUME_ACTION, async (ctx) =>
      await this.job_reconciler.run(ctx, { loop: ctx.input.loop === true }), {
      auth: ["admin"],
    });

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

  /** 初始化 AI Usage Repository 与查询索引，并引导异步任务恢复。 */
  protected override async on_init(): Promise<void> {
    const database = this.require_service_database();
    await this.settlement_runtime.initialize({
      database,
      usage_records: this.require_service_table<AIUsageRecord>("usage_records"),
      settlement_jobs: this.require_service_table<AISettlementJobRecord>("settlement_jobs"),
    });
    // 关键点（中文）：恢复是兜底能力，启动失败不能反过来拖垮 Federation。
    await this.job_reconciler.start();
  }

  /** UsageService 使用的 AI 技术用量只读入口。 */
  async aggregate_user_daily_usage(input: UserDailyUsageQuery): Promise<AIDailyUsageResult> {
    return await this.settlement_runtime.aggregate_user_daily_usage(input);
  }

  /** UsageService 使用的最近 AI Token 用量只读入口。 */
  async list_user_recent_usage(input: UserRecentAIUsageQuery): Promise<AIRecentUsageResult> {
    return await this.settlement_runtime.list_user_recent_usage(input);
  }

  /** 按日期范围聚合 Federation 全部用户的 AI 技术用量。 */
  async aggregate_admin_usage(input: AdminUsageQuery): Promise<AdminAIUsageResult> {
    return await this.settlement_runtime.aggregate_admin_usage(input);
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
            ctx.input.call as unknown as ModelCall,
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
    call: ModelCall,
    mode: string,
  ): AIResolvedRoutingPlan {
    return resolve_text_routing_plan(resolved, call, mode, {
      resolve_model: (input) => this.models.get(input),
      resolve_action: (model, target_mode) => this.getAction(model, target_mode),
      is_available: (model) => this.models.get_missing_env(model, ctx.env).length === 0,
    });
  }

  // ========== SDK 通路 ==========

  private async handleModality(modality: Modality, ctx: Context): Promise<unknown | Response> {
    const initial_resolved = this.resolve({ model: this.normalizeModelId(ctx.input.model), mode: modality }, ctx.env);
    const resolved = initial_resolved;
    const fallback_from = undefined;
    const fallback_reason = undefined;
    const fallback_media_type = undefined;
    const reasoning = undefined;
    this.attachResolvedModel(ctx, resolved.model, modality, { fallback_from, fallback_reason, fallback_media_type });
    attach_resolved_reasoning(ctx, reasoning);
    const started_at = Date.now();
    this.settlement_runtime.ensure_usage_id(ctx);

    try {
      const channel_output = await resolved.action(ctx);
      const { output, charge } = this.settlement_runtime.resolve_channel_output(channel_output);
      this.settlement_runtime.attach_output_metering(ctx, output, modality, started_at);
      const resolved_charge = charge ?? (resolved.model
        ? resolved.model.bill?.(this.settlement_runtime.build_bill_input(ctx, resolved.model, output))
        : undefined);
      const settlement = this.settlement_runtime.settle_execution({
        ctx,
        output,
        outcome: "succeeded",
        started_at,
        charge: resolved_charge,
      });
      if (isResponse(output)) {
        return await this.settlement_runtime.bind_settlement_response(ctx, output, settlement);
      }
      await settlement;
      return output;
    } catch (error) {
      await this.settlement_runtime.settle_execution({
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
   * 执行 Downcity Model Protocol 模型流调用。
   *
   * 路由、fallback 和 reasoning 仍由 AIService 统一拥有；AIChannel 负责执行标准
   * 模型流，结算运行时处理计量，transport 模块只编码 SSE。
   */
  private async handleLanguageModelStream(ctx: Context): Promise<Response> {
    const request = decode_city_language_model_request(ctx.input);
    const call = prepare_city_language_model_call(request.call);
    ctx.input = {
      ...ctx.input,
      model: request.model_id,
      call,
    };
    const initial_resolved = this.resolve({ model: request.model_id, mode: LANGUAGE_MODEL_MODE }, ctx.env);
    const routing = this.plan_text_execution(initial_resolved, ctx, call, LANGUAGE_MODEL_MODE);
    const resolved = routing.resolved;
    if (resolved.model) {
      ctx.input.call = project_model_call_for_execution(call, resolved.model);
    }
    const reasoning = resolved.model ? resolve_model_reasoning(resolved.model, call.reasoning) : undefined;
    this.attachResolvedModel(ctx, resolved.model, LANGUAGE_MODEL_MODE, routing);
    attach_resolved_reasoning(ctx, reasoning);
    const started_at = Date.now();
    this.settlement_runtime.ensure_usage_id(ctx);

    let output: unknown;
    try {
      output = await resolved.action(ctx);
    } catch (error) {
      await this.settlement_runtime.settle_execution({
        ctx,
        output: undefined,
        outcome: "failed",
        started_at,
      });
      throw error;
    }
    if (!is_language_model_stream_result(output)) {
      const error = httpError(500, "AIChannel stream did not return a Downcity model stream result");
      await this.settlement_runtime.settle_execution({
        ctx,
        output: undefined,
        outcome: "failed",
        started_at,
      });
      throw error;
    }
    const execution = create_city_language_model_stream({
      stream: output.stream,
    });
    const settlement = execution.completion.then(async (completion) => {
      const part = completion.result;
      if (part) {
        this.settlement_runtime.attach_output_metering(ctx, part, LANGUAGE_MODEL_MODE, started_at);
      }
      const charge = part && resolved.model?.bill
        ? resolved.model.bill(this.settlement_runtime.build_bill_input(ctx, resolved.model, part))
        : undefined;
      await this.settlement_runtime.settle_execution({
        ctx,
        output: part,
        outcome: completion.outcome,
        started_at,
        charge,
      });
    });
    return await this.settlement_runtime.bind_settlement_response(ctx, execution.response, settlement);
  }

  // ========== OpenAI 兼容通路 ==========

  private async handleChatCompletions(ctx: Context): Promise<Response> {
    try {
      const body = ctx.input as unknown as OpenAIChatCompletionRequest;
      const model_id = this.normalizeModelId(body.model);
      const call = openai_chat_request_to_language_model_call(body);
      ctx.input = {
        ...body,
        model: model_id,
        call,
      };
      const initial_resolved = this.resolve({ model: model_id, mode: LANGUAGE_MODEL_MODE }, ctx.env);
      const routing = this.plan_text_execution(initial_resolved, ctx, call, LANGUAGE_MODEL_MODE);
      const resolved = routing.resolved;
      if (resolved.model) {
        ctx.input.call = project_model_call_for_execution(call, resolved.model);
      }
      const reasoning = resolved.model
        ? resolve_model_reasoning(resolved.model, body)
        : undefined;
      this.attachResolvedModel(ctx, resolved.model, "openai", routing);
      attach_resolved_reasoning(ctx, reasoning);
      const started_at = Date.now();
      this.settlement_runtime.ensure_usage_id(ctx);

      const output = await resolved.action(ctx);
      if (!is_language_model_stream_result(output)) {
        throw httpError(500, "AIChannel stream did not return a Downcity model stream result");
      }
      const execution = await create_openai_chat_completion_response({
        model_id: resolved.model?.id ?? model_id ?? "",
        stream: body.stream === true,
        result: output,
      });
      const settlement = execution.completion.then(async (completion) => {
        if (completion) {
          this.settlement_runtime.attach_output_metering(ctx, completion, "openai", started_at);
        }
        const charge = completion && resolved.model?.bill
          ? resolved.model.bill(
              this.settlement_runtime.build_bill_input(ctx, resolved.model, completion),
            )
          : undefined;
        await this.settlement_runtime.settle_execution({
          ctx,
          output: completion,
          outcome: completion ? "succeeded" : "failed",
          started_at,
          charge,
        });
      });
      return await this.settlement_runtime.bind_settlement_response(
        ctx,
        execution.response,
        settlement,
      );
    } catch (error) {
      if (ctx.locals.ai_usage_id) {
        await this.settlement_runtime.settle_execution({
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
