/**
 * @downcity/city/power 主入口。
 *
 * 该入口只定义 Power 与 City 之间的最小协议，不包含 Agent 或 Electron 实现。
 * Power 包直接导出一个实例，由 City 统一管理完整生命周期。
 */

export { create_action } from "./runtime.js";
export { Power } from "./Power.js";

export type {
  PowerJsonObject,
  PowerJsonPrimitive,
  PowerJsonValue,
} from "./types/Json.js";

export type {
  PowerNotificationInput,
  PowerNotificationPublisher,
  PowerNotificationTopicInput,
  PowerRendererNotification,
} from "./types/PowerNotification.js";

export type {
  PowerAgentHandle,
  PowerCityHandle,
  PowerCityPowers,
  PowerContext,
  PowerLogger,
  PowerLogDetails,
  PowerLogLevel,
  PowerSessionCollection,
  PowerSessionHandle,
  PowerSessionMutation,
  PowerSessionOrigin,
  PowerSessionPromptContent,
  PowerSessionTurnHandle,
  PowerSessionTurnResult,
  PowerStorage,
  PowerTurnHandle,
  PowerWorkspaceHandle,
} from "./types/PowerContext.js";

export type {
  AnyPowerActionResult,
  CreatePowerActionOptions,
} from "./runtime.js";

export type {
  CityPowerRegistration,
  PowerDefinition,
  PowerAction,
  PowerActionApi,
  PowerActionCommand,
  PowerActionCommandInput,
  PowerActionExample,
  PowerActionInputSchema,
  PowerActionMessage,
  PowerActionReadView,
  PowerActionResult,
  PowerActions,
  PowerAvailability,
  PowerEffectHook,
  PowerGuardHook,
  PowerHooks,
  PowerHttpDefinition,
  PowerHttpRegistration,
  PowerPipelineHook,
  PowerReadView,
  PowerResolveHook,
  PowerResolves,
  PowerSessionExecutionScope,
  PowerSnapshot,
  PowerState,
  PowerView,
} from "./types/PowerRuntime.js";
export { PowerCall, create_power_call } from "./types/PowerCall.js";
export { StepSnapshot } from "./types/StepSnapshot.js";
export type {
  PowerCallSite,
  PowerRuntimeHost,
} from "./types/PowerCallSite.js";

export type {
  PowerConfigAction,
  PowerConfigActionContext,
  PowerHostAction,
  PowerHostAgent,
  PowerHostSessionTurn,
  PowerHostSystem,
  PowerHostWorkspace,
  PowerConfigStore,
  PowerSelf,
  PowerLifecycleContext,
} from "./types/PowerHost.js";


export type {
  AgentPowerRuntime,
} from "./types/PowerExecutionRuntime.js";
