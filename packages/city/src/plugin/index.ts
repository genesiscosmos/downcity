/**
 * @downcity/city/plugin 主入口。
 *
 * 该入口只定义 Plugin main 与宿主之间的最小协议，不包含 City、Agent 或 Electron
 * 实现。Plugin 包可以直接默认导出 `define_plugin_main(...)` 的结果。
 */

import type { PluginMainModule } from "./types/PluginMain.js";

export {
  BasePlugin,
  create_action,
  create_plugin,
  define_city_plugin,
} from "./runtime.js";

/** 保留 Plugin main 的精确类型并返回原对象。 */
export function define_plugin_main(module: PluginMainModule): PluginMainModule {
  return module;
}

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
  PluginProfile,
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
  CreatePluginOptions,
} from "./runtime.js";

export type {
  CityPluginMainContext,
  CityPluginModule,
  CityPluginRegistration,
  Plugin,
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
  PluginFactoryContext,
  PluginGuardHook,
  PluginHooks,
  PluginHttpDefinition,
  PluginHttpRegistration,
  PluginLifecycle,
  PluginLifecycleContext,
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
  PluginConfigMainAction,
  PluginConfigMainActionContext,
  PluginMainAction,
  PluginMainAgent,
  PluginMainContext,
  PluginMainLogger,
  PluginMainModule,
  PluginMainSelf,
  PluginMainSystem,
  PluginMainWorkspace,
  PluginProfileConfigStore,
} from "./types/PluginMain.js";

export { ActionScheduleStore } from "./schedule/ActionScheduleStore.js";
export { parse_action_schedule_run_at_ms_or_throw } from "./schedule/ActionScheduleTime.js";
export type {
  ActionScheduleJobRecord,
  ActionScheduleJobStatus,
  CreateActionScheduleJobInput,
  PluginActionScheduleInput,
} from "./schedule/ActionSchedule.js";
