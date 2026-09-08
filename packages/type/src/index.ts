/**
 * @downcity/type 公共协议入口。
 *
 * 这里只导出跨 package 共享的稳定协议，具体运行时实现由各 SDK package 自己负责。
 */

export {
  CITY_MODEL_KIND,
  isCityModel,
} from "./types/CityModel.js";

export type {
  CityModel,
  CityModelDescriptor,
  CityModelEnvRequirement,
  CityModelReasoning,
  CityModelReasoningEffort,
  ModelPricing,
} from "./types/CityModel.js";

export type { AuthRoutePolicy } from "./types/auth/AuthRoute.js";

export type { CityRuntime } from "./types/city/CityRuntime.js";

export {
  MODEL_PROTOCOL_VERSION,
  ModelStreamValidator,
  read_model_context_window,
  read_model_label,
} from "./types/model/index.js";
export type {
  ModelCall,
  ModelClient,
  ModelContent,
  ModelError,
  ModelErrorCode,
  ModelFileBase64Source,
  ModelFileContent,
  ModelFileSource,
  ModelFileUrlSource,
  ModelFinishReason,
  ModelJsonContent,
  ModelJsonValue,
  ModelMessage,
  ModelReasoningContent,
  ModelReasoningRequest,
  ModelRequestFailureNotice,
  ModelRequestKind,
  ModelResponseFormat,
  ModelStreamEnvelope,
  ModelStreamEvent,
  ModelStreamRequest,
  ModelTextContent,
  ModelTool,
  ModelToolCallContent,
  ModelToolChoice,
  ModelToolResultContent,
  ModelToolResultPart,
  ModelUsage,
} from "./types/model/index.js";

export {
  define_runtime_tool,
  type RuntimeTool,
  type RuntimeToolEffect,
  type RuntimeToolExecutionOptions,
} from "./types/tool/index.js";

export * from "./workspace.js";
export * from "./shell.js";
export * from "./session.js";
