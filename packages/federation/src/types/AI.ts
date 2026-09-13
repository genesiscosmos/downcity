/**
 * City AI 领域类型模块。
 *
 * 本模块集中定义 AIChannel、模型、计费、图片任务以及内部路由类型。
 * 公共入口只导出用户配置和 Channel 实现所需的最小类型集合。
 */

import type {
  CityModelEnvRequirement,
  CityModelReasoning,
  ModelCall,
  ModelFileContent,
  ModelJsonValue,
  ModelPricing,
  ModelStreamEvent,
} from "@downcity/type";
import type { ActionFn } from "../service/action.js";
import type { Context } from "../service/service.js";
import type { AsyncJobRecord } from "./AsyncJob.js";
import type { RuntimeMetering } from "./Metering.js";

// ===========================================================================
// Downcity Model Protocol 边界
// ===========================================================================

/** AIChannel 返回的标准模型事件流。 */
export interface AIChannelStreamResult {
  /** Downcity Model Protocol 事件流。 */
  readonly stream: ReadableStream<ModelStreamEvent>;
  /** 可选上游请求审计信息。 */
  readonly request?: AIProviderRequestMetadata;
}

/** Provider 请求的安全审计信息。 */
export interface AIProviderRequestMetadata {
  /** 上游请求 ID。 */
  request_id?: string;
  /** 不包含密钥和敏感正文的附加信息。 */
  metadata?: Record<string, ModelJsonValue>;
}

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
  /** Channel 下所有模型共享的服务端 Provider 配置。 */
  provider_options?: Record<string, ModelJsonValue>;
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
  /** 标准 Downcity 模型调用。 */
  readonly call: ModelCall;
  /** AIService 已解析完成的最终模型。 */
  readonly model: AIChannelModel;
  /** 读取 Federation 服务端环境变量。 */
  readonly env: (key: string) => string | undefined;
  /** AIService 已校验的可选 reasoning。 */
  readonly reasoning?: AIResolvedReasoning;
  /** 当前 HTTP 请求的取消信号。 */
  readonly abort_signal?: AbortSignal;
  /** Channel 与模型合并后的服务端 Provider 配置。 */
  readonly provider_options?: Record<string, ModelJsonValue>;
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

/** 模型级媒体 fallback 规则。 */
export interface AIModelFallbackRule {
  /** 判断最新用户消息中的当前文件是否命中规则。 */
  match: (file: ModelFileContent) => boolean;
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
  /** 不公开给客户端的模型级 Provider 配置。 */
  provider_options?: Record<string, ModelJsonValue>;
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
  call: ModelCall,
) => Promise<AIChannelStreamResult>;

/** 非语言模型 action 映射。 */
export interface AIModelActions {
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
export interface AIModelDefinition extends Omit<AIModelSpec, "provider_options"> {
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
// 非语言 Action 消息
// ===========================================================================

/** 非语言 AI Action 返回的文本内容。 */
export interface AIActionTextPart {
  /** 内容判别字段。 */
  type: "text";
  /** 面向调用方展示的文本。 */
  text: string;
}

/** 非语言 AI Action 返回的文件内容。 */
export interface AIActionFilePart {
  /** 内容判别字段。 */
  type: "file";
  /** 文件的 IANA MIME 类型。 */
  media_type: string;
  /** 调用方可以读取的文件 URL 或 data URL。 */
  url: string;
  /** 可选原始文件名。 */
  filename?: string;
}

/** 非语言 AI Action 可返回的消息内容。 */
export type AIActionMessagePart = AIActionTextPart | AIActionFilePart;

/** Federation 非语言 AI Action 的稳定消息协议。 */
export interface AIActionMessage {
  /** 消息的稳定唯一标识。 */
  id: string;
  /** AI Action 输出固定归属于 assistant。 */
  role: "assistant";
  /** 按展示顺序排列的消息内容。 */
  parts: AIActionMessagePart[];
  /** Action、模型与计量等可选扩展信息。 */
  metadata?: Record<string, unknown>;
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
  /** 成功时返回的 Downcity 非语言 Action 消息。 */
  result?: AIActionMessage;
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
