/**
 * AI Service 调用器（对应 service/ai/ai-service.ts AIService）。
 *
 * 路由：/v1/ai/{modality} 和 /v1/ai/models。
 */

import {
  type CityModelDescriptor,
} from "@downcity/type";
import { CityModel } from "./CityModel.js";
import { create_client_ui_stream } from "./client-stream.js";
import type { UserModelRef } from "./types.js";
import type { CityLanguageModelStreamRequestV1 } from "../../../types/AITransport.js";
import type {
  UserImageInput,
  UserImageJobCreateResult,
  UserImageJobResult,
  UserImageJobResultInput,
  UserAsrInput,
  UserAsrResult,
  UserServiceInput,
  UserStreamResult,
  UserTextResult,
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
 * await city.ai.text({ model: "deepseek-v4-flash", prompt: "hello" });
 * const catalog = await city.ai.catalog();
 * ```
 */
export class AIInvoker {
  private readonly req: <T>(path: string, init: RequestInitLike) => Promise<T>;
  private readonly reqRaw: (path: string, init: RequestInitLike) => Promise<FetchResponseLike>;
  private readonly input: (input: UserServiceInput) => Record<string, unknown>;
  private readonly baseUrl: string;

  constructor(opts: {
    baseUrl: string;
    requestJSON: <T>(path: string, init: RequestInitLike) => Promise<T>;
    requestRaw: (path: string, init: RequestInitLike) => Promise<FetchResponseLike>;
    buildInput: (input: UserServiceInput) => Record<string, unknown>;
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
   * - 产品侧可以把该地址传给 OpenAI SDK 或 AI SDK provider 的 `baseURL`。
   */
  get base_url(): string {
    return `${this.baseUrl}/v1/ai`;
  }

  /** 文本生成。支持 tools 参数（ai-sdk tool 格式，自动序列化去掉 execute） */
  text(input: UserServiceInput): Promise<UserTextResult> {
    return this.req<UserTextResult>(`${PREFIX}/text`, {
      method: "POST",
      body: JSON.stringify(this.input(this.serializeTools(input))),
    });
  }

  /**
   * 使用 CityModel 流式生成 UIMessageChunk。
   *
   * Federation `/v1/ai/stream` 只传输 LanguageModelV3 事件；UIMessage 转换在客户端完成。
   */
  async stream(input: UserServiceInput): Promise<UserStreamResult> {
    return create_client_ui_stream(input, this.resolve_city_model(input.model));
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
    return this.post<UserImageJobResult>("/image/result", input as unknown as UserServiceInput);
  }

  /** 视频生成 */
  video(input: UserServiceInput): Promise<UserVideoResult> {
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
    return new ModelCatalog(body.items, (descriptor) => this.create_city_model(descriptor));
  }

  /** 将模型输入解析为绑定当前鉴权请求器的 CityModel。 */
  private resolve_city_model(model: UserModelRef | string): UserModelRef {
    if (model && typeof model === "object") return model;
    if (typeof model !== "string") throw new TypeError("model is required");
    const model_id = model.trim();
    if (!model_id) throw new TypeError("model must be a non-empty string");
    return this.create_city_model({
      id: model_id,
      name: model_id,
      description: "",
      modalities: ["text", "stream"],
      tags: [],
      meta: {},
    });
  }

  /** 使用公开目录描述创建可执行 CityModel。 */
  private create_city_model(descriptor: CityModelDescriptor): UserModelRef {
    return new CityModel({
      descriptor,
      request_stream: (request, signal) => this.request_model_stream(request, signal),
    });
  }

  private post<T>(path: string, input: UserServiceInput): Promise<T> {
    return this.req<T>(`${PREFIX}${path}`, {
      method: "POST",
      body: JSON.stringify(this.input(input)),
    });
  }

  /**
   * 解析 AI SDK / OpenAI function tool 的名称。
   */
  private resolveToolName(name: unknown, def: unknown): string {
    const direct_name = typeof name === "string" ? name.trim() : "";
    if (direct_name) return direct_name;
    if (!def || typeof def !== "object") return "";
    const record = def as {
      name?: unknown;
      function?: { name?: unknown };
    };
    const provider_name =
      typeof record.name === "string" ? record.name.trim() : "";
    if (provider_name) return provider_name;
    return typeof record.function?.name === "string"
      ? record.function.name.trim()
      : "";
  }

  /**
   * 解析 AI SDK v6 provider tool / OpenAI function tool 的参数 schema。
   */
  private resolveToolParameters(def: unknown): unknown {
    if (!def || typeof def !== "object") return {};
    const record = def as {
      parameters?: unknown;
      inputSchema?: unknown;
      function?: { parameters?: unknown };
    };
    const input_schema = record.inputSchema as
      | { jsonSchema?: unknown }
      | undefined;
    return (
      record.function?.parameters ??
      record.parameters ??
      input_schema?.jsonSchema ??
      record.inputSchema ??
      {}
    );
  }

  /**
   * 将 ai-sdk tool 格式序列化为 OpenAI function 格式（去掉 execute，只保留 schema）。
   */
  private serializeToolDefinition(
    name: unknown,
    def: unknown,
  ): Record<string, unknown> | null {
    const tool_name = this.resolveToolName(name, def);
    if (!tool_name) return null;
    const record = def && typeof def === "object"
      ? (def as {
          description?: unknown;
          function?: { description?: unknown };
        })
      : {};
    return {
      type: "function",
      function: {
        name: tool_name,
        description:
          typeof record.function?.description === "string"
            ? record.function.description
            : typeof record.description === "string"
              ? record.description
              : "",
        parameters: this.resolveToolParameters(def),
      },
    };
  }

  /** 将 ai-sdk tool 格式序列化为 OpenAI function 格式（去掉 execute，只保留 schema） */
  private serializeTools(input: UserServiceInput): UserServiceInput {
    const { tools, ...rest } = input;
    const body: Record<string, unknown> = { ...rest };
    if (Array.isArray(tools)) {
      // 关键点（中文）：AI SDK v6 传给自定义 provider 的 tools 是
      // `{ type, name, inputSchema }`，City server 需要 OpenAI function 形态。
      body.tools = tools
        .map((def) => this.serializeToolDefinition(undefined, def))
        .filter((def): def is Record<string, unknown> => def !== null);
      return body as UserServiceInput;
    }
    if (tools && typeof tools === "object") {
      body.tools = Object.entries(tools as Record<string, unknown>)
        .map(([name, def]) => this.serializeToolDefinition(name, def))
        .filter((def): def is Record<string, unknown> => def !== null);
    }
    return body as UserServiceInput;
  }
}

// ===================================================================
// ModelCatalog
// ===================================================================

/**
 * 模型目录（AIInvoker.catalog() 返回值）。
 */
export class ModelCatalog {
  private readonly byId: Map<string, UserModelRef>;

  constructor(
    items: CityModelDescriptor[],
    create_model: (descriptor: CityModelDescriptor) => UserModelRef,
  ) {
    if (!items?.length) {
      this.byId = new Map();
      return;
    }

    const enriched = items.map(create_model);

    this.byId = new Map(enriched.map((item) => [item.id, item]));
  }

  get(id: string): UserModelRef | undefined {
    return this.byId.get(String(id ?? "").trim());
  }

  all(): UserModelRef[] {
    return [...this.byId.values()];
  }

  forModality(modality: string): UserModelRef[] {
    const m = String(modality ?? "").trim();
    return [...this.byId.values()].filter((item) => item.modalities.includes(m));
  }
}

/** 将 UserModelInput 转为字符串 */
export function serializeModel(model: import("./types.js").UserModelInput | undefined): string | undefined {
  if (!model) return undefined;
  return typeof model === "string" ? model : model.id;
}
