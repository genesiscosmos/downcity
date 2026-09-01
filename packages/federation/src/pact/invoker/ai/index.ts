/**
 * AI Service 调用器（对应 service/ai/ai-service.ts AIService）。
 *
 * 路由：/v1/ai/{modality} 和 /v1/ai/models。
 */

import {
  type CityModelDescriptor,
} from "@downcity/type";
import { CityModel } from "./CityModel.js";
import type {
  FederationModelInput,
  FederationModelStreamInput,
} from "./types.js";
import type { CityModel as FederationModel } from "./CityModel.js";
import type { CityLanguageModelStreamRequestV1 } from "../../../types/AITransport.js";
import type {
  UserImageInput,
  UserImageJobCreateResult,
  UserImageJobResult,
  UserImageJobResultInput,
  UserAsrInput,
  UserAsrResult,
  FederationActionInput,
  UserStreamResult,
  UserTtsInput,
  UserTtsResult,
  UserVideoResult,
} from "../../user/types.js";
import type { FetchResponseLike, RequestInitLike } from "../../http.js";

const PREFIX = "/v1/ai";

/**
 * AI 服务调用器。
 *
 * 通过 User City .ai 访问：
 * ```ts
 * const stream = await city.ai.stream({ model: "deepseek-v4-flash", call });
 * const catalog = await city.ai.catalog();
 * ```
 */
export class AIInvoker {
  private readonly req: <T>(path: string, init: RequestInitLike) => Promise<T>;
  private readonly reqRaw: (path: string, init: RequestInitLike) => Promise<FetchResponseLike>;
  private readonly input: (input: FederationActionInput) => Record<string, unknown>;
  private readonly baseUrl: string;

  constructor(opts: {
    baseUrl: string;
    requestJSON: <T>(path: string, init: RequestInitLike) => Promise<T>;
    requestRaw: (path: string, init: RequestInitLike) => Promise<FetchResponseLike>;
    buildInput: (input: FederationActionInput) => Record<string, unknown>;
  }) {
    this.baseUrl = opts.baseUrl;
    this.req = opts.requestJSON;
    this.reqRaw = opts.requestRaw;
    this.input = opts.buildInput;
  }

  /**
   * OpenAI-compatible endpoint 根地址。
   *
   * 关键点（中文）
   * - SDK 只暴露稳定 HTTP endpoint，不绑定任何第三方 provider。
   * - 产品侧可以把该地址传给 OpenAI SDK 或兼容客户端的 `baseURL`。
   */
  get base_url(): string {
    return `${this.baseUrl}/v1/ai`;
  }

  /**
   * 使用 CityModel 执行一个 Downcity Model Protocol step。
   */
  async stream(input: FederationModelStreamInput): Promise<UserStreamResult> {
    return this.resolve_model(input.model).stream(input.call, input.signal);
  }

  /** 使用当前 City user 鉴权上下文调用模型流端点。 */
  private request_model_stream(
    request: CityLanguageModelStreamRequestV1,
    signal?: AbortSignal,
  ): Promise<FetchResponseLike> {
    return this.reqRaw(`${PREFIX}/stream`, {
      method: "POST",
      body: JSON.stringify(request),
      signal,
    });
  }

  /** 创建图片生成任务 */
  image_create(input: UserImageInput): Promise<UserImageJobCreateResult> {
    return this.post<UserImageJobCreateResult>("/image/create", input);
  }

  /** 查询图片生成任务 */
  image_result(input: UserImageJobResultInput): Promise<UserImageJobResult> {
    return this.req<UserImageJobResult>(`${PREFIX}/image/result`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** 视频生成 */
  video(input: FederationActionInput): Promise<UserVideoResult> {
    return this.post<UserVideoResult>("/video", input);
  }

  /** 语音合成 */
  tts(input: UserTtsInput): Promise<UserTtsResult> {
    return this.post<UserTtsResult>("/tts", input);
  }

  /** 语音识别 */
  asr(input: UserAsrInput): Promise<UserAsrResult> {
    return this.post<UserAsrResult>("/asr", input);
  }

  /** 获取当前用户可用的 CityModel 目录。 */
  async catalog(): Promise<ModelCatalog> {
    const body = await this.req<{ items: CityModelDescriptor[] }>(`${PREFIX}/models`, { method: "GET" });
    return new ModelCatalog(body.items, (descriptor) => this.create_model(descriptor));
  }

  /** 获取一个绑定当前鉴权上下文的可执行 Federation 模型。 */
  model(model_id: string): FederationModel {
    return this.resolve_model(model_id);
  }

  /** 将模型输入解析为绑定当前鉴权请求器的 CityModel。 */
  private resolve_model(model: FederationModelInput): FederationModel {
    if (model && typeof model === "object") return model;
    if (typeof model !== "string") throw new TypeError("model is required");
    const model_id = model.trim();
    if (!model_id) throw new TypeError("model must be a non-empty string");
    return this.create_model({
      id: model_id,
      name: model_id,
      description: "",
      modalities: ["text", "stream"],
      tags: [],
      meta: {},
    });
  }

  /** 使用公开目录描述创建可执行 CityModel。 */
  private create_model(descriptor: CityModelDescriptor): FederationModel {
    return new CityModel({
      descriptor,
      request_stream: (request, signal) => this.request_model_stream(request, signal),
    });
  }

  private post<T>(path: string, input: FederationActionInput): Promise<T> {
    return this.req<T>(`${PREFIX}${path}`, {
      method: "POST",
      body: JSON.stringify(this.input(input)),
    });
  }

}

// ===================================================================
// ModelCatalog
// ===================================================================

/**
 * 模型目录（AIInvoker.catalog() 返回值）。
 */
export class ModelCatalog {
  private readonly byId: Map<string, FederationModel>;

  constructor(
    items: CityModelDescriptor[],
    create_model: (descriptor: CityModelDescriptor) => FederationModel,
  ) {
    if (!items?.length) {
      this.byId = new Map();
      return;
    }

    const enriched = items.map(create_model);

    this.byId = new Map(enriched.map((item) => [item.id, item]));
  }

  get(id: string): FederationModel | undefined {
    return this.byId.get(String(id ?? "").trim());
  }

  /** 获取模型；模型不存在时抛出明确错误。 */
  require(id: string): FederationModel {
    const model = this.get(id);
    if (!model) throw new Error(`Federation model not found: ${String(id ?? "").trim()}`);
    return model;
  }

  all(): FederationModel[] {
    return [...this.byId.values()];
  }

  forModality(modality: string): FederationModel[] {
    const m = String(modality ?? "").trim();
    return [...this.byId.values()].filter((item) => item.modalities.includes(m));
  }
}

/** 将 Federation 模型引用转换为请求中的模型 ID。 */
export function serialize_model(model: FederationModelInput | undefined): string | undefined {
  if (!model) return undefined;
  return typeof model === "string" ? model : model.id;
}
