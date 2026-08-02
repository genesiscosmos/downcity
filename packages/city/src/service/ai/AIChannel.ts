/**
 * Federation AIChannel 基类模块。
 *
 * AIChannel 是 Federation 服务端的上游 AI 执行渠道。语言能力只通过标准
 * LanguageModelV3 `stream(input)` 暴露，text action 由同一标准流自动派生。
 */

import type {
  AIChannelOptions,
  AIChannelActionInput,
  AIChannelModel,
  AIChannelStreamInput,
  AIBillInput,
  AICharge,
  AIChargedResult,
  AIImageCreateResult,
  AIImageResult,
  AIModelActions,
  AIModelDefinition,
  AIModelSpec,
  AIModelStream,
  AISDKProviderOptions,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamResult,
} from "../../types/AI.js";
import type { UIMessage } from "ai";
import type { Context } from "../service.js";
import { execute_language_model_text } from "./language-model-text.js";
import { read_resolved_reasoning } from "./reasoning.js";

/** Federation 服务端 AI 执行渠道。 */
export abstract class AIChannel {
  /** Channel 唯一 ID。 */
  readonly id: string;
  /** Channel 所需环境变量及管理员说明。 */
  readonly env?: Record<string, string>;
  /** 上游 API 根地址，由子类显式使用。 */
  protected readonly base_url?: string;
  /** 默认 API Key 对应的 Federation env key。 */
  protected readonly env_key?: string;
  /** reasoning 映射使用的 AI SDK providerOptions 命名空间。 */
  private readonly ai_sdk_provider_id?: string;
  /** Channel 级 AI SDK providerOptions 默认值。 */
  private readonly ai_sdk_provider_options?: AISDKProviderOptions;

  constructor(options: AIChannelOptions) {
    this.id = options.id;
    this.env = options.env ?? (options.env_key
      ? { [options.env_key]: `${options.id} API Key` }
      : undefined);
    this.base_url = options.base_url;
    this.env_key = options.env_key;
    this.ai_sdk_provider_id = options.ai_sdk_provider_id?.trim() || undefined;
    this.ai_sdk_provider_options = clone_provider_options(
      options.ai_sdk_provider_options,
    );
  }

  /**
   * 可选语言模型执行入口。
   *
   * 子类实现后，该 Channel 注册的模型自动获得 text 与 stream 能力。
   */
  protected stream?(input: AIChannelStreamInput): Promise<LanguageModelV3StreamResult>;

  /**
   * 把 AIService 已校验 reasoning 映射成真实 AI SDK Provider 的选项。
   *
   * 默认实现适用于使用 `reasoningEffort` 的 Provider；其它 Provider 应覆盖。
   */
  protected build_reasoning_provider_options(
    input: AIChannelStreamInput,
  ): AISDKProviderOptions | undefined {
    const reasoning = input.reasoning;
    if (!reasoning) return undefined;
    const provider_id = this.ai_sdk_provider_id;
    if (!provider_id) {
      throw new Error(
        `AIChannel ${this.id} requires ai_sdk_provider_id to map reasoning options`,
      );
    }
    return {
      [provider_id]: {
        reasoningEffort: reasoning.effort,
      },
    };
  }

  /** 构建传给 Channel stream 的完整显式输入。 */
  private build_stream_input(
    ctx: Context,
    call: LanguageModelV3CallOptions,
    model: AIChannelStreamInput["model"],
    model_provider_options: AISDKProviderOptions | undefined,
  ): AIChannelStreamInput {
    const { providerOptions: _client_provider_options, ...safe_call } = call;
    const reasoning = read_resolved_reasoning(ctx);
    const base_input: AIChannelStreamInput = {
      call: safe_call as LanguageModelV3CallOptions,
      model,
      env: (key) => ctx.env(key),
      ...(reasoning ? { reasoning } : {}),
    };
    const provider_options = merge_provider_options(
      this.ai_sdk_provider_options,
      model_provider_options,
      this.build_reasoning_provider_options(base_input),
    );
    return {
      ...base_input,
      call: {
        ...safe_call,
        ...(provider_options ? { providerOptions: provider_options } : {}),
      } as LanguageModelV3CallOptions,
    };
  }

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
  video?(input: AIChannelActionInput): Promise<AIChargedResult<UIMessage>>;
  /** 语音合成 action。 */
  tts?(input: AIChannelActionInput): Promise<AIChargedResult<Response>>;
  /** 语音识别 action。 */
  asr?(input: AIChannelActionInput): Promise<AIChargedResult<Response>>;

  /** 把当前 Channel 下的模型声明转换为 Federation 内部模型定义。 */
  model(spec: AIModelSpec): AIModelDefinition {
    const model_provider_options = clone_provider_options(
      spec.ai_sdk_provider_options,
    );

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
      if (typeof fn === "function") {
        const action = fn.bind(this) as (
          input: AIChannelActionInput,
        ) => unknown | Promise<unknown>;
        actions[modality] = (ctx: Context) =>
          action(this.build_action_input(ctx, channel_model));
      }
    }

    const stream: AIModelStream | undefined = this.stream
      ? (ctx, call) => this.stream!(this.build_stream_input(
          ctx,
          call,
          channel_model,
          model_provider_options,
        ))
      : undefined;
    if (stream) {
      actions.text = (ctx: Context) =>
        execute_language_model_text(ctx, stream, this.id);
    }

    const {
      ai_sdk_provider_options: _ai_sdk_provider_options,
      ...model_spec
    } = spec;

    return {
      ...model_spec,
      channel_id: this.id,
      ...(spec.price ? { price: [...spec.price] } : {}),
      env: this.env,
      runtime: {
        ...(stream ? { stream } : {}),
        actions,
      },
      bill: spec.bill ?? this.bill.bind(this),
    };
  }

  /** 从通用 Action Context 构造 Channel 允许访问的领域输入。 */
  private build_action_input(
    ctx: Context,
    model: AIChannelModel,
  ): AIChannelActionInput {
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

/** 复制服务端 providerOptions，避免调用方原地修改已注册配置。 */
function clone_provider_options(
  input: AISDKProviderOptions | undefined,
): AISDKProviderOptions | undefined {
  return input ? structuredClone(input) : undefined;
}

/** 按 AI SDK Provider ID 浅合并 providerOptions。 */
function merge_provider_options(
  ...sources: Array<AISDKProviderOptions | undefined>
): AISDKProviderOptions | undefined {
  const merged: AISDKProviderOptions = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [provider_id, options] of Object.entries(source)) {
      merged[provider_id] = {
        ...merged[provider_id],
        ...options,
      };
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
