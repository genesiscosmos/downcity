/**
 * City AI 领域类型模块。
 *
 * 本模块集中定义 AIChannel、模型、计费、图片任务以及内部路由类型。
 * 公共入口只导出用户配置和 Channel 实现所需的最小类型集合。
 */

import type { LanguageModel, UIMessage } from "ai";
import type {
  CityModelEnvRequirement,
  CityModelReasoning,
  ModelPricing,
} from "@downcity/type";
import type { ActionFn } from "../service/action.js";
import type { Context } from "../service/service.js";
import type { AsyncJobRecord } from "./AsyncJob.js";
import type { RuntimeMetering } from "./Metering.js";

// ===========================================================================
// AI SDK 标准边界
// ===========================================================================

/** AI SDK LanguageModelV3。 */
export type LanguageModelV3 = Extract<
  LanguageModel,
  { readonly specificationVersion: "v3" }
>;

/** LanguageModelV3 的标准调用参数。 */
export type LanguageModelV3CallOptions = Parameters<LanguageModelV3["doStream"]>[0];

/** LanguageModelV3 的标准流结果。 */
export type LanguageModelV3StreamResult = Awaited<ReturnType<LanguageModelV3["doStream"]>>;

/** LanguageModelV3 的标准流事件，仅供 City 内部 transport 使用。 */
export type LanguageModelV3StreamPart =
  LanguageModelV3StreamResult["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

/** LanguageModelV3 的标准非流式结果，仅供 City 内部聚合使用。 */
export type LanguageModelV3GenerateResult = Awaited<ReturnType<LanguageModelV3["doGenerate"]>>;

/** AI SDK 按 Provider ID 分组的服务端私有调用选项。 */
export type AISDKProviderOptions = NonNullable<LanguageModelV3CallOptions["providerOptions"]>;

/** AIService 已校验的推理强度。 */
export interface AIResolvedReasoning {
  /** 最终模型接受的推理强度档位 ID。 */
  effort: string;
  /** 档位来自调用方请求还是模型默认配置。 */
  source: "request" | "default";
}

// ===========================================================================
// AIChannel 与模型
// ===========================================================================

/** AIChannel 构造参数。 */
export interface AIChannelOptions {
  /** Federation 中的 Channel 唯一 ID。 */
  id: string;
  /** Channel 所需环境变量及管理员说明。 */
  env?: Record<string, string>;
  /** 上游 API 根地址，由 Channel 子类显式使用。 */
  base_url?: string;
  /** Channel 默认 API Key 对应的 Federation env key。 */
  env_key?: string;
  /** reasoning 映射使用的 AI SDK providerOptions 命名空间。 */
  ai_sdk_provider_id?: string;
  /** Channel 下所有模型共享的 AI SDK providerOptions 默认值。 */
  ai_sdk_provider_options?: AISDKProviderOptions;
}

/** AIService 已解析完成、可供 Channel 执行的模型身份。 */
export interface AIChannelModel {
  /** Federation 对外模型 ID。 */
  readonly id: string;
  /** 真实上游模型 ID。 */
  readonly upstream_model: string;
}

/** AIChannel 语言执行时可读取的显式输入。 */
export interface AIChannelStreamInput {
  /** 已移除客户端私有选项并注入服务端 providerOptions 的标准调用。 */
  readonly call: LanguageModelV3CallOptions;
  /** AIService 已解析完成的最终模型。 */
  readonly model: AIChannelModel;
  /** 读取 Federation 服务端环境变量。 */
  readonly env: (key: string) => string | undefined;
  /** AIService 已校验的可选 reasoning。 */
  readonly reasoning?: AIResolvedReasoning;
}

/** AIChannel 非语言 action 可读取的显式输入。 */
export interface AIChannelActionInput {
  /** 当前 action 的业务输入。 */
  readonly input: Record<string, unknown>;
  /** AIService 已解析完成的最终模型。 */
  readonly model: AIChannelModel;
  /** 读取 Federation 服务端环境变量。 */
  readonly env: (key: string) => string | undefined;
  /** 当前请求的可选用户 ID。 */
  readonly user_id?: string;
  /** 当前请求所属的可选 Bureau ID。 */
  readonly bureau_id?: string;
  /** 图片抓取 action 可读取的异步任务上下文。 */
  readonly image_job?: AIImageJobContext;
}

/** fallback 匹配时使用的媒体信息。 */
export interface AIModelFallbackMedia {
  /** file part 的 IANA 媒体类型。 */
  media_type: string;
  /** 输入文件名。 */
  filename?: string;
  /** 输入文件 URL 或 Data URL。 */
  url?: string;
}

/** 模型级媒体 fallback 规则。 */
export interface AIModelFallbackRule {
  /** 判断当前媒体是否命中规则。 */
  match: (media: AIModelFallbackMedia) => boolean;
  /** fallback 目标 Federation 模型 ID。 */
  model_id: string;
}

/** AIChannel.model() 接收的模型声明。 */
export interface AIModelSpec {
  /** Federation 模型目录中的唯一 ID。 */
  id: string;
  /** 真实上游模型 ID，不向普通客户端公开。 */
  upstream_model: string;
  /** 面向用户展示的模型名称。 */
  name: string;
  /** 面向用户展示的模型说明。 */
  description?: string;
  /** 模型支持的总上下文窗口，单位为 token。 */
  context_window?: number;
  /** 模型目录标签。 */
  tags?: string[];
  /** 结构化价格方案；多个方案用于表达条件、时段或档位差异。 */
  pricing?: ModelPricing | ModelPricing[];
  /** 兼容旧客户端的价格说明列表，由 pricing 派生。 */
  price?: string[];
  /** 不公开给客户端的模型级 AI SDK providerOptions。 */
  ai_sdk_provider_options?: AISDKProviderOptions;
  /** 可公开给客户端的模型扩展信息。 */
  meta?: Record<string, unknown>;
  /** 模型公开的 reasoning 能力。 */
  reasoning?: CityModelReasoning;
  /** 模型级媒体 fallback 规则。 */
  fallback?: AIModelFallbackRule[];
  /** 模型成功执行后的账单草稿生成函数。 */
  bill?: AIBill;
}

/** Channel 语言模型执行函数。 */
export type AIModelStream = (
  ctx: Context,
  call: LanguageModelV3CallOptions,
) => Promise<LanguageModelV3StreamResult>;

/** 非语言模型 action 映射。 */
export interface AIModelActions {
  /** 由 AIModelStream 自动派生的 text action。 */
  text?: ActionFn;
  /** 图片任务创建 action。 */
  image_create?: ActionFn;
  /** 图片任务抓取 action。 */
  image_fetch?: ActionFn;
  /** 图片任务查询 action。 */
  image_result?: ActionFn;
  /** 视频生成 action。 */
  video?: ActionFn;
  /** 语音合成 action。 */
  tts?: ActionFn;
  /** 语音识别 action。 */
  asr?: ActionFn;
  /** 扩展 modality action。 */
  [modality: string]: ActionFn | undefined;
}

/** AIService 执行模型所需的内部运行时。 */
export interface AIModelRuntime {
  /** 可选的标准语言模型流入口。 */
  stream?: AIModelStream;
  /** 图片、视频、TTS、ASR 等 action。 */
  actions: AIModelActions;
}

/** Federation 内部已注册、可路由、可执行的模型定义。 */
export interface AIModelDefinition extends Omit<AIModelSpec, "ai_sdk_provider_options"> {
  /** 当前模型所属 AIChannel ID。 */
  channel_id: string;
  /** 当前模型所需的 Federation 环境变量。 */
  env?: Record<string, string>;
  /** 当前模型的服务端执行运行时。 */
  runtime: AIModelRuntime;
}

/** AI 模型环境变量需求。 */
export type AIModelEnvRequirement = CityModelEnvRequirement;

/** AIService 配置。 */
export interface AIServiceOptions {
  /** AI 专用 Credits 桥接。 */
  credits?: AICreditsBridge;
  /** 图片异步任务允许保持 queued/running 的最长时间，单位毫秒。 */
  image_max_pending_duration_ms?: number;
}

// ===========================================================================
// 计费
// ===========================================================================

/** AIChannel 计算出的单次扣费结果。 */
export interface AICharge {
  /** 可选扣费用户 ID。 */
  user_id?: string;
  /** 扣费额度，单位为 credits。 */
  credits: number;
  /** 账单说明。 */
  note?: string;
  /** 外部引用 ID。 */
  ref?: string;
  /** 内部审计信息。 */
  metadata?: Record<string, unknown>;
}

/** AIService 提交给外部 Credits bridge 的扣费输入。 */
export interface AICreditsChargeInput extends AICharge {
  /** 当前用户 ID。 */
  user_id: string;
  /** 相同键的重复提交必须只产生一次扣费。 */
  idempotency_key: string;
  /** Credits Transaction 的业务来源。 */
  source: "model_usage";
}

/** AIService 依赖的最小 Credits bridge。 */
export interface AICreditsBridge {
  /** 执行 Credits 前置检查。 */
  precheck?(user_id: string, needed_credits?: number): Promise<{ available_credits: number }>;
  /** 执行扣费并记录账单。 */
  charge(input: AICreditsChargeInput): Promise<unknown>;
}

/** Channel 或模型生成账单时可读取的显式输入。 */
export interface AIBillInput {
  /** 一次真实 AI 执行及其结算的稳定标识。 */
  readonly usage_id: string;
  /** 本次模型执行的最终输出。 */
  readonly output: unknown;
  /** AIService 已解析完成的最终模型。 */
  readonly model: AIChannelModel;
  /** 本次结算使用的结构化价格方案；由 AIService 从最终模型注入。 */
  readonly pricing?: ModelPricing | ModelPricing[];
  /** AIService 已归一化的可选计量信息。 */
  readonly metering?: RuntimeMetering;
  /** 当前请求的可选用户 ID。 */
  readonly user_id?: string;
  /** 当前请求所属的可选 Bureau ID。 */
  readonly bureau_id?: string;
}

/** Channel 或模型生成扣费行的方法。 */
export type AIBill = (
  input: AIBillInput,
) => AICharge | Promise<AICharge | undefined> | undefined;

/** AIChannel action 返回的统一带计费结果。 */
export interface AIChargedResult<T = unknown> {
  /** 对外返回的 action 输出。 */
  output: T;
  /** AIChannel 已计算好的可选扣费结果。 */
  charge?: AICharge | Promise<AICharge | undefined>;
}

// ===========================================================================
// 图片任务
// ===========================================================================

/** 图片任务状态。 */
export type AIImageStatus = "queued" | "running" | "succeeded" | "failed";

/** image_create 返回的固定协议。 */
export interface AIImageCreateResult {
  /** 图片任务 ID。 */
  job_id: string;
  /** 创建后的任务状态。 */
  status: AIImageStatus;
  /** 当前任务状态说明。 */
  message?: string;
  /** 失败时返回的错误消息。 */
  error?: string;
  /** 建议下一次查询结果的间隔毫秒数。 */
  poll_after_ms?: number;
  /** 上游扩展元数据。 */
  metadata?: Record<string, unknown>;
}

/** image_fetch 与 image_result 共用的固定协议。 */
export interface AIImageResult extends AIImageCreateResult {
  /** 成功时返回的 AI SDK UIMessage。 */
  result?: UIMessage;
}

/** AIChannel 在 image_fetch 中可读取的图片任务上下文。 */
export interface AIImageJobContext {
  /** async_jobs 中保存的完整任务记录。 */
  record: AsyncJobRecord;
  /** image_create 时的原始输入。 */
  input: Record<string, unknown>;
  /** image_create 或 image_fetch 返回的上游状态。 */
  state?: Record<string, unknown>;
}

/** 已被当前 worker 原子领取的图片任务。 */
export interface AIImageJobClaim {
  /** 进入 fetching 状态后的完整任务记录。 */
  record: AsyncJobRecord;
  /** 本次领取写入的时间戳，也是后续 CAS 的所有权令牌。 */
  claimed_at: string;
}

// ===========================================================================
// 内部路由
// ===========================================================================

/** 已解析的模型 action。 */
export interface AIResolvedAction {
  /** 本次 action 绑定的最终模型定义。 */
  model?: AIModelDefinition;
  /** 本次请求实际执行的 Channel action。 */
  action: ActionFn;
}

/** 模型发生 fallback 的标准原因。 */
export type AIRoutingFallbackReason = "input_requires_media";

/** 最终模型路由计划。 */
export interface AIResolvedRoutingPlan {
  /** 最终执行的模型和 action。 */
  resolved: AIResolvedAction;
  /** 发生 fallback 时的原模型 ID。 */
  fallback_from?: string;
  /** 发生 fallback 时的标准原因。 */
  fallback_reason?: AIRoutingFallbackReason;
  /** 触发 fallback 的媒体类型。 */
  fallback_media_type?: string;
}

/** 媒体 fallback 路由访问模型注册表所需的能力。 */
export interface AIModelRoutingAdapter {
  /** 解析 fallback 目标模型 ID。 */
  resolve_model(model_id: string): AIModelDefinition | undefined;
  /** 解析目标模型在指定通路下的 action。 */
  resolve_action(model: AIModelDefinition, mode: string): ActionFn | undefined;
  /** 判断目标模型当前是否满足运行条件。 */
  is_available(model: AIModelDefinition): boolean;
}
