/**
 * @downcity/type 公共协议入口。
 *
 * 导出跨 package 的稳定协议与共享模型流期限，业务执行和恢复由各 SDK 负责。
 */

export { normalize_agent_role } from "./AgentIdentity.js";

export type { SessionRuntimeSnapshot, SessionRuntimeState } from "./types/session/SessionRuntime.js";
export type { SessionPromptActor } from "./types/session/SessionPromptActor.js";

export {
  CITY_MODEL_KIND,
  is_downtown_model_reference,
  is_model_reference,
  same_model,
  isCityModel,
} from "./types/CityModel.js";

export type {
  CityModel,
  CityModelDescriptor,
  CityModelEnvRequirement,
  CityModelReasoning,
  CityModelReasoningEffort,
  CityModelType,
  DowntownModelReference,
  ClientModelReference,
  ModelReference,
  ModelPricing,
} from "./types/CityModel.js";

export type { PromptPower, PromptPowerAction, PromptPowerDescriptor, PromptPowerActionDescriptor, PromptPowerActionExample, PromptPowerCallContext, PromptPowerCall, PromptPowerEvent, PromptPowerResult } from "./types/session/PromptPower.js";

export type { AuthRoutePolicy } from "./types/auth/AuthRoute.js";

export type { CityRuntime, PowerSurface } from "./types/city/CityRuntime.js";

export {
  MODEL_PROTOCOL_VERSION,
  ModelStreamValidator,
  read_model_context_window,
  read_model_label,
  read_model_error,
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

export { guard_model_stream, resolve_model_stream_policy, is_model_output_event, create_model_timeout_error } from "./ModelStreamGuard.js";
export type { ModelStreamPolicy, ModelTimeoutPhase, ModelExecutionError } from "./types/model/ModelStreamPolicy.js";

export {
  define_agent_tool,
  EMPTY_TOOL_HOOK_SET,
  type AgentTool,
  type EffectHook,
  type GuardHook,
  type PipelineHook,
  type ToolEffect,
  type ToolHookSet,
} from "./types/tool/index.js";

export type {
  ToolCallContext,
  ToolCallUserMessage,
} from "./types/session/ToolCallContext.js";

export * from "./workspace.js";
export * from "./shell.js";
export * from "./session.js";
export {
  format_date_in_timezone,
  format_date_time_in_timezone,
  format_year_in_timezone,
  resolve_runtime_timezone,
} from "./types/time/Time.js";
