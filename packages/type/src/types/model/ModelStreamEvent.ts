/**
 * Downcity 模型流事件协议模块。
 *
 * 所有增量内容通过稳定 content_id 形成可校验的 start、delta、finish 生命周期。
 */

import type { ModelJsonValue } from "./ModelJson.js";
import type { ModelError } from "./ModelError.js";
import type { ModelUsage } from "./ModelUsage.js";
import { MODEL_PROTOCOL_VERSION } from "./ModelCall.js";

/** 标准模型完成原因。 */
export type ModelFinishReason =
  | "stop"
  | "length"
  | "tool_call"
  | "content_filter"
  | "cancelled"
  | "error"
  | "unknown";

/** 单次模型执行产生的标准流事件。 */
export type ModelStreamEvent =
  | { type: "model_start"; request_id: string; model_id: string }
  | { type: "text_start"; content_id: string }
  | { type: "text_delta"; content_id: string; delta: string }
  | { type: "text_finish"; content_id: string }
  | { type: "reasoning_start"; content_id: string }
  | { type: "reasoning_delta"; content_id: string; delta: string }
  | { type: "reasoning_finish"; content_id: string; signature?: string }
  | {
      type: "tool_call_start";
      content_id: string;
      tool_call_id: string;
      tool_name: string;
    }
  | { type: "tool_call_delta"; content_id: string; input_delta: string }
  | { type: "tool_call_finish"; content_id: string; input: ModelJsonValue }
  | { type: "model_usage"; usage: ModelUsage }
  | { type: "model_finish"; finish_reason: ModelFinishReason }
  | { type: "model_error"; error: ModelError };

/** Federation SSE 中单个模型流事件的版本化信封。 */
export interface ModelStreamEnvelope {
  /** Downcity Model Protocol 版本。 */
  protocol_version: typeof MODEL_PROTOCOL_VERSION;
  /** 当前标准模型流事件。 */
  event: ModelStreamEvent;
}
