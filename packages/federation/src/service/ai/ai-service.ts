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
import type { CityModelDescriptor, CityModelType, ModelCall } from "@downcity/type";
import type {
  AIChannelStreamResult,
  AIDecisionRequest,
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
import { validate_ai_decision_request, validate_ai_decision_result } from "./decision-validation.js";
import { RelayRuntime } from "../relay/runtime.js";
import { relay_tables } from "../relay/schema.js";

/** AIService 直接暴露的 action 模态列表。模型流与图片任务使用独立 handler。 */
const MODALITIES = ["video", "tts", "asr", "decision"] as const;
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
  /** 可选模型中转控制与执行层。 */
  readonly relay?: RelayRuntime;

  constructor(options: AIServiceOptions = {}) {
    super({
      id: "ai",
      name: "AI",
      tables: {
        async_jobs: sqliteAsyncJobs,
        usage_records: ai_usage_records,
        settlement_jobs: ai_settlement_jobs,
        ...(options.relay ? relay_tables : {}),
      },
    });
    if (options.relay) this.relay = new RelayRuntime(this);
    this.settlement_runtime = new AISettlementRuntime({ credits: options.credits });
    this.image_runtime = new AIImageJobRuntime({
      image_max_pending_duration_ms: options.image_max_pending_duration_ms,
      resolve_action: (query, env) => this.resolve(query, env),
      resolve_model: (model_id) => this.models.get(model_id),
      attach_resolved_model: (ctx, model, mode) => this.attachResolvedModel(ctx, model, mode),
    }, this.settlement_runtime);

    // 为每个 modality 注册 routing action
    for (const modality of MODALITIES) {
      this.action(modality, async (ctx) => this.handleModality(modality, ctx), {
        auth: ["user", "admin"],
      }).before((ctx) => this.settlement_runtime.precheck(ctx));
    }

    // `/stream` 是 CityModel 唯一模型流入口，不经过旧 UIMessage action。
    this.action("stream", async (ctx) => this.handleLanguageModelStream(ctx), {
      auth: ["user", "admin"],
    }).before(async (ctx) => { await Promise.all([this.settlement_runtime.precheck(ctx), this.relay?.precheck(ctx)]); });

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
    }).before(async (ctx) => { await Promise.all([this.settlement_runtime.precheck(ctx), this.relay?.precheck(ctx)]); });

    // Queue 只负责唤醒；数据库 Settlement Job 才是可靠结算事实源。
    this.action("settlement/process", async (ctx) => {
      const usage_id = readOptionalString(ctx.input.usage_id);
      if (!usage_id) throw httpError(422, "usage_id is required");
      return await this.settlement_runtime.process_settlement(ctx, usage_id);
    }, { auth: ["admin"] });

    // 模型列表走同一路径，根据身份决定可见范围。
    this.action("models", async (ctx) => {
      const items = AIService.listModels(this, { env: ctx.env, identity: ctx.identity?.kind ?? "guest" });
      if (!this.relay) return { items };
      const descriptors = AIService.listModels(this, { env: () => "configured", identity: "user" });
      const relay_items = await this.relay.list_models(ctx, descriptors);
      const native_items = ctx.locals.relay_principal ? [] : items.filter((item) => !this.models.get(item.id)?.runtime.stream);
      return { items: [...relay_items, ...native_items] };
    }, { method: "GET", auth: ["user", "admin"] });
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
    if (this.relay) {
      await this.relay.initialize({
        database,
        table: <T extends Record<string, unknown>>(name: string) => this.require_service_table<T>(name),
        models: this.models.list(),
      });
    }
    await this.settlement_runtime.initialize({
      database,
      usage_records: this.require_service_table<AIUsageRecord>("usage_records"),
      settlement_jobs: this.require_service_table<AISettlementJobRecord>("settlement_jobs"),
    });
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

  /**
   * 从 runtime 能力推导模型类别。
   *
   * 关键点（中文）
   * - 与 getModelModalities() 同源，都只读 runtime，避免出现第二个可写事实源。
   * - 一个模型同时具备多种能力时按固定优先级取主类别；stream 优先，因此混合模型
   *   对外仍是 language，与消费端「能否担任对话模型」的判断保持一致。
   * - 注册阶段已校验至少有一个可执行能力，因此这里一定能得到结果。
   */
  private getModelType(model: AIModelDefinition): CityModelType {
    if (model.runtime.stream) return "language";
    if (model.runtime.actions.decision) return "decision";
    if (model.runtime.actions.image_create) return "image";
    if (model.runtime.actions.tts || model.runtime.actions.asr) return "sound";
    return "video";
  }

  /**
   * 各 modality 进入 Channel 前的协议校验。
   *
   * 关键点（中文）
   * - 必须在 ensure_usage_id() 之前调用：被拒绝的请求不应留下用量事实。
   * - 只有闭合且带类型的协议需要校验；tts / asr 之类是厂商形状透传，原样通过。
   * - 返回归一化后的决策请求，供结果校验复用。
   */
  private prepare_modality_input(modality: Modality, ctx: Context): AIDecisionRequest | undefined {
    if (modality !== "decision") return undefined;
    const request = validate_ai_decision_request(ctx.input);
    ctx.input = { ...ctx.input, ...request };
    return request;
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
    const decision_request = this.prepare_modality_input(modality, ctx);
    const resolved = this.resolve({ model: this.normalizeModelId(ctx.input.model), mode: modality }, ctx.env);
    this.attachResolvedModel(ctx, resolved.model, modality);
    const started_at = Date.now();
    this.settlement_runtime.ensure_usage_id(ctx);

    try {
      const channel_output = await resolved.action(ctx);
      const { output, charge } = this.settlement_runtime.resolve_channel_output(channel_output);
      // 上游异常形状同样属于协议违例，必须在计量前拦住，避免把脏数据写进账单。
      const validated_output = decision_request
        ? validate_ai_decision_result(output, decision_request)
        : output;
      this.settlement_runtime.attach_output_metering(ctx, validated_output, modality, started_at);
      const resolved_charge = charge ?? (resolved.model
        ? resolved.model.bill?.(this.settlement_runtime.build_bill_input(ctx, resolved.model, validated_output))
        : undefined);
      const settlement = this.settlement_runtime.settle_execution({
        ctx,
        output: validated_output,
        outcome: "succeeded",
        started_at,
        charge: resolved_charge,
      });
      if (isResponse(validated_output)) {
        return await this.settlement_runtime.bind_settlement_response(ctx, validated_output, settlement);
      }
      await settlement;
      return validated_output;
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
    const initial_resolved = this.relay
      ? await this.resolve_relay_model(ctx, request.model_id)
      : this.resolve({ model: request.model_id, mode: LANGUAGE_MODEL_MODE }, ctx.env);
    const routing = this.relay ? { resolved: initial_resolved } : this.plan_text_execution(initial_resolved, ctx, call, LANGUAGE_MODEL_MODE);
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

  /** 将 Relay 包装为既有 AIService action，保留统一协议转换和结算链路。 */
  private async resolve_relay_model(ctx: Context, model_id: string | undefined): Promise<AIResolvedAction> {
    if (!model_id) throw httpError(422, "model is required");
    const model = await this.relay!.resolve(ctx, model_id);
    return { model, action: (execution_ctx) => model.runtime.stream!(execution_ctx, execution_ctx.input.call as unknown as ModelCall) };
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
      const initial_resolved = this.relay
        ? await this.resolve_relay_model(ctx, model_id)
        : this.resolve({ model: model_id, mode: LANGUAGE_MODEL_MODE }, ctx.env);
      const routing = this.relay ? { resolved: initial_resolved } : this.plan_text_execution(initial_resolved, ctx, call, LANGUAGE_MODEL_MODE);
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
      get_model_type: (model) => aiService.getModelType(model),
    });
  }
}
