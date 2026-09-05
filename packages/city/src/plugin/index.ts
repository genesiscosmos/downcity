/**
 * @downcity/city/plugin 主入口。
 *
 * 该入口只定义 Plugin 与 City 之间的最小协议，不包含 Agent 或 Electron 实现。
 * Plugin 包直接导出一个实例，由 City 统一管理完整生命周期。
 */

export {
  Plugin,
  create_action,
} from "./runtime.js";

export type {
  PluginJsonObject,
  PluginJsonPrimitive,
  PluginJsonValue,
} from "./types/Json.js";

export type {
  PluginNotificationInput,
  PluginNotificationPublisher,
  PluginNotificationTopicInput,
  PluginRendererNotification,
} from "./types/PluginNotification.js";

export type {
  PluginAgentHandle,
  PluginCityHandle,
  PluginCityPlugins,
  PluginContext,
  PluginLogger,
  PluginLogDetails,
  PluginLogLevel,
  PluginSessionCollection,
  PluginSessionContextSnapshot,
  PluginSessionHandle,
  PluginSessionMutation,
  PluginSessionOrigin,
  PluginSessionPromptPart,
  PluginSessionTurnHandle,
  PluginSessionTurnResult,
  PluginStorage,
  PluginTurnHandle,
  PluginWebServices,
  PluginWorkspaceHandle,
} from "./types/PluginContext.js";

export type {
  AnyPluginActionResult,
  CreatePluginActionOptions,
} from "./runtime.js";

export type {
  CityPluginRegistration,
  PluginDefinition,
  PluginAction,
  PluginActionApi,
  PluginActionCommand,
  PluginActionCommandInput,
  PluginActionExample,
  PluginActionExecutionContext,
  PluginActionInputSchema,
  PluginActionMessage,
  PluginActionReadView,
  PluginActionResult,
  PluginActions,
  PluginAvailability,
  PluginEffectHook,
  PluginExecutionContext,
  PluginGuardHook,
  PluginHooks,
  PluginHttpDefinition,
  PluginHttpRegistration,
  PluginPipelineHook,
  PluginReadView,
  PluginResolveHook,
  PluginResolves,
  PluginSessionExecutionScope,
  PluginSnapshot,
  PluginState,
  PluginView,
} from "./types/PluginRuntime.js";

export type {
  PluginConfigAction,
  PluginConfigActionContext,
  PluginHostAction,
  PluginHostAgent,
  PluginHostSystem,
  PluginHostWorkspace,
  PluginProfileConfigStore,
  PluginSelf,
  PluginStartContext,
} from "./types/PluginHost.js";

export type {
  AgentPluginExecutionLease,
  AgentPluginExecutionRuntime,
  AgentPluginExecutionView,
  AgentPluginRuntime,
} from "./types/PluginExecutionRuntime.js";

export { ActionScheduleStore } from "./schedule/ActionScheduleStore.js";
export { parse_action_schedule_run_at_ms_or_throw } from "./schedule/ActionScheduleTime.js";
export type {
  ActionScheduleJobRecord,
  ActionScheduleJobStatus,
  CreateActionScheduleJobInput,
  PluginActionScheduleInput,
} from "./schedule/ActionSchedule.js";
