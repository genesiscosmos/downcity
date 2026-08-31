/**
 * Downcity 模型调用协议模块。
 *
 * ModelCall 与模型目录身份分离，同一调用可以由 Federation 路由到不同最终模型。
 */

import type { ModelMessage } from "./ModelMessage.js";
import type { ModelTool, ModelToolChoice } from "./ModelTool.js";

/** 单次标准模型调用。 */
export interface ModelCall {
  /** 按模型上下文顺序排列的完整消息。 */
  messages: ModelMessage[];
  /** 本轮可供模型调用的工具。 */
  tools?: ModelTool[];
  /** 本轮工具选择策略。 */
  tool_choice?: ModelToolChoice;
  /** 最大输出 token 数。 */
  max_output_tokens?: number;
  /** 采样温度。 */
  temperature?: number;
  /** nucleus sampling 参数。 */
  top_p?: number;
  /** 候选 token 数限制。 */
  top_k?: number;
  /** presence penalty。 */
  presence_penalty?: number;
  /** frequency penalty。 */
  frequency_penalty?: number;
  /** 按顺序匹配的停止序列。 */
  stop_sequences?: string[];
  /** 可选确定性采样种子。 */
  seed?: number;
  /** 用户可请求的推理设置。 */
  reasoning?: ModelReasoningRequest;
  /** 模型输出格式约束。 */
  response_format?: ModelResponseFormat;
}

/** 用户可请求的模型推理设置。 */
export interface ModelReasoningRequest {
  /** 是否启用模型推理。 */
  enabled: boolean;
  /** 用户选择的可选推理强度。 */
  effort?: string;
}

/** 模型输出格式约束。 */
export type ModelResponseFormat =
  | { type: "text" }
  | { type: "json" }
  | {
      type: "json_schema";
      /** JSON Schema 的稳定名称。 */
      name: string;
      /** 面向模型的可选 Schema 说明。 */
      description?: string;
      /** 模型输出必须遵循的 JSON Schema。 */
      schema: { [key: string]: import("./ModelJson.js").ModelJsonValue };
    };

/** 当前 Downcity Model Protocol 的固定版本。 */
export const MODEL_PROTOCOL_VERSION = 1 as const;

/** Agent 或客户端发给 Federation 的流式模型请求。 */
export interface ModelStreamRequest {
  /** Downcity Model Protocol 版本。 */
  protocol_version: typeof MODEL_PROTOCOL_VERSION;
  /** 用户选择的 Federation 模型 ID。 */
  model_id: string;
  /** 标准模型调用。 */
  call: ModelCall;
}
