/**
 * City AI transport 内部类型模块。
 *
 * 本模块只服务于 CityModel transport 和 OpenAI HTTP adapter，
 * 不从 @downcity/agent 公共入口导出。
 */

import type { FetchResponseLike } from "../pact/http.js";
import type {
  CityModelDescriptor,
  ModelCall,
  ModelFinishReason,
  ModelMessage,
  ModelStreamEvent,
  ModelStreamRequest,
  ModelUsage,
} from "@downcity/type";

// ===========================================================================
// CityModel transport
// ===========================================================================

/** CityModel 发给 Federation 的标准模型调用。 */
export type CityLanguageModelStreamRequestV1 = ModelStreamRequest;

/** Federation 通过 SSE 返回的标准模型流事件。 */
/** 已校验并解码的 CityModel transport 请求。 */
export interface DecodedCityLanguageModelRequest {
  /** Federation 模型目录中的模型 ID。 */
  model_id: string;
  /** 已校验的标准 Downcity 模型调用。 */
  call: ModelCall;
}

/** 供运行时校验的原始 CityModel transport 请求。 */
export type RawCityLanguageModelRequest =
  | CityLanguageModelStreamRequestV1
  | Record<string, unknown>;

/** 创建 Federation SSE 响应所需的输入。 */
export interface CreateCityLanguageModelStreamInput {
  /** 最终 AIChannel 返回的标准 Downcity 模型事件流。 */
  stream: ReadableStream<ModelStreamEvent>;
}

/** Federation SSE 响应及其最终完成事件。 */
export interface CityLanguageModelStreamExecution {
  /** 返回给 CityModel 客户端的 SSE Response。 */
  response: Response;
  /** 流结束后的明确完成结果。 */
  completion: Promise<AIStreamCompletion<ModelStreamCompletionResult>>;
}

/** Federation 完成一次模型流后用于计量与结算的标准事实。 */
export interface ModelStreamCompletionResult {
  /** Provider 返回的最终累计 usage。 */
  usage: ModelUsage;
  /** 正常完成或失败的终态事件。 */
  terminal_event: Extract<ModelStreamEvent, { type: "model_finish" | "model_error" }>;
}

/** 流式 AI 响应的明确完成结果。 */
export type AIStreamCompletion<TResult> =
  | {
      /** 上游流正常结束并提供最终可信 usage。 */
      outcome: "succeeded";
      /** 最终标准化结果。 */
      result: TResult;
    }
  | {
      /** 上游执行或传输失败。 */
      outcome: "failed";
      /** finish 后失败时仍可携带可信最终结果。 */
      result?: TResult;
      /** 原始错误，仅供运行时判断和日志使用。 */
      error: unknown;
    }
  | {
      /** 客户端主动取消流。 */
      outcome: "cancelled";
      /** 取消前已经获得的可选最终结果。 */
      result?: TResult;
    };

/** CityModel 客户端构造参数。 */
export interface CityModelOptions {
  /** Federation 模型目录返回的公开描述。 */
  descriptor: CityModelDescriptor;
  /** 使用 City 客户端鉴权上下文发送模型请求。 */
  request_stream(
    request: ModelStreamRequest,
    signal?: AbortSignal,
  ): Promise<FetchResponseLike>;
}

// ===========================================================================
// OpenAI Chat Completions adapter
// ===========================================================================

/** OpenAI Chat Completions 请求。 */
export interface OpenAIChatCompletionRequest {
  /** Federation 模型目录中的模型 ID。 */
  model: string;
  /** 本次对话消息列表。 */
  messages: OpenAIChatMessage[];
  /** 是否返回 OpenAI SSE 数据流。 */
  stream?: boolean;
  /** 最大输出 token 数；优先级高于 max_tokens。 */
  max_completion_tokens?: number;
  /** 兼容旧客户端的最大输出 token 数。 */
  max_tokens?: number;
  /** 采样温度。 */
  temperature?: number;
  /** nucleus sampling 参数。 */
  top_p?: number;
  /** 停止序列。 */
  stop?: string | string[];
  /** presence penalty。 */
  presence_penalty?: number;
  /** frequency penalty。 */
  frequency_penalty?: number;
  /** 确定性采样种子。 */
  seed?: number;
  /** 可供模型调用的 function tools。 */
  tools?: OpenAIChatTool[];
  /** 工具选择策略。 */
  tool_choice?: OpenAIChatToolChoice;
  /** 文本或 JSON 输出格式。 */
  response_format?: OpenAIChatResponseFormat;
  /** Downcity 对外公开的推理强度。 */
  reasoning_effort?: string;
  /** 其它兼容字段不会直接进入 AIChannel。 */
  [key: string]: unknown;
}

/** OpenAI 对话消息。 */
export interface OpenAIChatMessage {
  /** 消息角色。 */
  role: "system" | "developer" | "user" | "assistant" | "tool";
  /** 文本或多模态消息内容。 */
  content?: string | OpenAIChatContentPart[] | null;
  /** assistant 消息中的历史工具调用。 */
  tool_calls?: OpenAIChatToolCall[];
  /** tool 消息对应的工具调用 ID。 */
  tool_call_id?: string;
  /** tool 消息对应的工具名称。 */
  name?: string;
}

/** OpenAI 多模态消息内容。 */
export type OpenAIChatContentPart =
  | OpenAIChatTextPart
  | OpenAIChatImagePart
  | OpenAIChatFilePart;

/** OpenAI 文本内容。 */
export interface OpenAIChatTextPart {
  /** 内容类型。 */
  type: "text" | "input_text";
  /** 文本内容。 */
  text: string;
}

/** OpenAI 图片内容。 */
export interface OpenAIChatImagePart {
  /** 内容类型。 */
  type: "image_url" | "input_image";
  /** Chat Completions image_url 对象。 */
  image_url?: { url: string };
  /** 部分兼容客户端使用的直接 URL。 */
  url?: string;
}

/** OpenAI 文件内容。 */
export interface OpenAIChatFilePart {
  /** 内容类型。 */
  type: "file";
  /** 文件 URL 或 Data URL。 */
  url: string;
  /** 文件 IANA 媒体类型。 */
  media_type?: string;
  /** 兼容 OpenAI 客户端输入的媒体类型字段。 */
  mediaType?: string;
  /** 可选文件名。 */
  filename?: string;
}

/** OpenAI function tool 定义。 */
export interface OpenAIChatTool {
  /** 工具类型。 */
  type: "function";
  /** function 定义。 */
  function: {
    /** 工具唯一名称。 */
    name: string;
    /** 工具说明。 */
    description?: string;
    /** 工具输入 JSON Schema。 */
    parameters?: Record<string, unknown>;
    /** 是否要求上游 Provider 严格遵循 schema。 */
    strict?: boolean;
  };
}

/** OpenAI 工具选择策略。 */
export type OpenAIChatToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

/** OpenAI 输出格式。 */
export type OpenAIChatResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        /** JSON schema 名称。 */
        name: string;
        /** JSON schema 说明。 */
        description?: string;
        /** 输出必须遵循的 JSON Schema。 */
        schema: Record<string, unknown>;
      };
    };

/** OpenAI assistant 历史工具调用。 */
export interface OpenAIChatToolCall {
  /** 工具调用 ID。 */
  id: string;
  /** 工具调用类型。 */
  type: "function";
  /** function 调用内容。 */
  function: {
    /** 工具名称。 */
    name: string;
    /** JSON 字符串形式的工具参数。 */
    arguments: string;
  };
}

/** OpenAI token usage。 */
export interface OpenAIChatUsage {
  /** 输入 token 总数。 */
  prompt_tokens: number;
  /** 输出 token 总数。 */
  completion_tokens: number;
  /** 输入与输出 token 总数。 */
  total_tokens: number;
  /** 输入 token 明细。 */
  prompt_tokens_details?: {
    /** 命中缓存的输入 token 数。 */
    cached_tokens: number;
  };
  /** 输出 token 明细。 */
  completion_tokens_details?: {
    /** 推理 token 数。 */
    reasoning_tokens: number;
  };
}

/** OpenAI adapter 输出与计费聚合状态。 */
export interface OpenAIChatCompletionExecution {
  /** 返回给 OpenAI-compatible 客户端的响应。 */
  response: Response;
  /** Downcity 模型聚合结果；异常或取消时为空。 */
  completion: Promise<ModelCompletionResult | undefined>;
}

/** 单个模型 step 的标准聚合结果。 */
export interface ModelCompletionResult {
  /** 聚合后的 assistant 模型消息。 */
  message: ModelMessage;
  /** 标准完成原因。 */
  finish_reason: ModelFinishReason;
  /** Provider 返回的最终可信 usage。 */
  usage?: ModelUsage;
}
