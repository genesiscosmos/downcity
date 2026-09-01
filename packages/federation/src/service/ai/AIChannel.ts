/**
 * Federation AIChannel 基类模块。
 *
 * AIChannel 是 Downcity Model Protocol 与单个上游 Provider 之间的执行边界。
 */

import type { ModelJsonValue, ModelPricing } from "@downcity/type";
import type {
  AIActionMessage,
  AIChannelActionInput,
  AIChannelModel,
  AIChannelOptions,
  AIChannelStreamInput,
  AIChannelStreamResult,
  AIBillInput,
  AICharge,
  AIChargedResult,
  AIImageCreateResult,
  AIImageResult,
  AIModelActions,
  AIModelDefinition,
  AIModelSpec,
  AIModelStream,
} from "../../types/AI.js";
import type { Context } from "../service.js";
import { read_resolved_reasoning } from "./reasoning.js";

/** Federation 服务端 AI 执行渠道。 */
export abstract class AIChannel {
  /** Channel 唯一 ID。 */
  readonly id: string;
  /** Channel 所需环境变量及管理员说明。 */
  readonly env?: Record<string, string>;
  /** 上游 API 根地址，由子类显式使用。 */
  protected readonly base_url?: string;
  /** Channel 级服务端 Provider 配置。 */
  private readonly provider_options?: Record<string, ModelJsonValue>;

  constructor(options: AIChannelOptions) {
    this.id = options.id;
    this.env = options.env;
    this.base_url = options.base_url;
    this.provider_options = clone_provider_options(options.provider_options);
  }

  /** 子类实现的标准 Downcity 模型流入口。 */
  protected stream?(input: AIChannelStreamInput): Promise<AIChannelStreamResult>;

  /** 模型成功完成后生成账单草稿。 */
  protected bill(_input: AIBillInput): AICharge | undefined {
    return undefined;
  }

  /** 图片任务创建 action。 */
  image_create?(input: AIChannelActionInput): Promise<AIImageCreateResult>;
  /** 图片任务抓取 action。 */
  image_fetch?(input: AIChannelActionInput): Promise<AIImageResult>;
  /** 图片任务查询 action。 */
  image_result?(input: AIChannelActionInput): Promise<AIImageResult>;
  /** 视频生成 action。 */
  video?(input: AIChannelActionInput): Promise<AIChargedResult<AIActionMessage>>;
  /** 语音合成 action。 */
  tts?(input: AIChannelActionInput): Promise<AIChargedResult<Response>>;
  /** 语音识别 action。 */
  asr?(input: AIChannelActionInput): Promise<AIChargedResult<Response>>;

  /** 把当前 Channel 下的模型声明转换为 Federation 内部模型定义。 */
  model(spec: AIModelSpec): AIModelDefinition {
    const model_provider_options = clone_provider_options(spec.provider_options);
    const actions: AIModelActions = {};
    const channel_model: AIChannelModel = Object.freeze({
      id: spec.id,
      upstream_model: spec.upstream_model,
    });
    const modalities = [
      "image_create",
      "image_fetch",
      "image_result",
      "video",
      "tts",
      "asr",
    ] as const;

    for (const modality of modalities) {
      const fn = (this as unknown as Record<string, unknown>)[modality];
      if (typeof fn !== "function") continue;
      const action = fn.bind(this) as (input: AIChannelActionInput) => unknown | Promise<unknown>;
      actions[modality] = (ctx: Context) => action(this.build_action_input(ctx, channel_model));
    }

    const stream: AIModelStream | undefined = this.stream
      ? async (ctx, call) => this.stream!(this.build_stream_input(
          ctx,
          call,
          channel_model,
          model_provider_options,
        ))
      : undefined;
    const { provider_options: _provider_options, ...model_spec } = spec;
    return {
      ...model_spec,
      channel_id: this.id,
      ...(spec.pricing ? { pricing: clone_pricing(spec.pricing) } : {}),
      env: this.env,
      runtime: {
        ...(stream ? { stream } : {}),
        actions,
      },
      bill: spec.bill ?? this.bill.bind(this),
    };
  }

  /** 构造只包含 Downcity 领域输入和服务端配置的 Provider 调用。 */
  private build_stream_input(
    ctx: Context,
    call: AIChannelStreamInput["call"],
    model: AIChannelModel,
    model_provider_options: Record<string, ModelJsonValue> | undefined,
  ): AIChannelStreamInput {
    const reasoning = read_resolved_reasoning(ctx);
    const provider_options = merge_provider_options(
      this.provider_options,
      model_provider_options,
    );
    return {
      call,
      model,
      env: (key) => ctx.env(key),
      ...(reasoning ? { reasoning } : {}),
      ...(ctx.request?.signal ? { abort_signal: ctx.request.signal } : {}),
      ...(provider_options ? { provider_options } : {}),
    };
  }

  /** 从通用 Action Context 构造 Channel 允许访问的领域输入。 */
  private build_action_input(ctx: Context, model: AIChannelModel): AIChannelActionInput {
    const image_job = ctx.locals.ai_image_job;
    return {
      input: ctx.input,
      model,
      env: (key) => ctx.env(key),
      ...(ctx.user?.user_id ? { user_id: ctx.user.user_id } : {}),
      ...(ctx.bureau?.bureau_id ? { bureau_id: ctx.bureau.bureau_id } : {}),
      ...(image_job && typeof image_job === "object"
        ? { image_job: image_job as AIChannelActionInput["image_job"] }
        : {}),
    };
  }
}

/** 复制模型价格方案，保持 Channel 与目录注册表之间的数据隔离。 */
function clone_pricing(pricing: AIModelSpec["pricing"]): ModelPricing[] {
  const values: ModelPricing[] = pricing ? (Array.isArray(pricing) ? pricing : [pricing]) : [];
  return values.map((item) => ({
    ...item,
    rates: { ...item.rates },
    ...(item.dimensions ? { dimensions: { ...item.dimensions } } : {}),
  }));
}

/** 复制服务端 Provider 配置，避免注册后被调用方原地修改。 */
function clone_provider_options(
  input: Record<string, ModelJsonValue> | undefined,
): Record<string, ModelJsonValue> | undefined {
  return input ? structuredClone(input) : undefined;
}

/** 合并 Channel 和模型级 Provider 配置。 */
function merge_provider_options(
  channel_options: Record<string, ModelJsonValue> | undefined,
  model_options: Record<string, ModelJsonValue> | undefined,
): Record<string, ModelJsonValue> | undefined {
  if (!channel_options && !model_options) return undefined;
  return {
    ...(channel_options ?? {}),
    ...(model_options ?? {}),
  };
}
