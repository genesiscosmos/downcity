/**
 * @downcity/agent — Agent 运行时公开 API。
 *
 * 关键点（中文）
 * - 这是 agent 包唯一稳定的公开入口。
 * - 只导出 Agent、plugin 作者 API、city 运行集成 API 与跨包协议类型。
 * - HTTP router、sandbox runner、内部 plugin runtime runner 等实现细节不从根入口暴露。
 */

// Agent 入口
export { Agent } from "./agent/Agent.js";
export { Workspace } from "./workspace/Workspace.js";
export type { AgentStore } from "./types/store/AgentStore.js";
export type {
  CompactActiveMessagesInput,
  CompactActiveMessagesResult,
  SessionMessageCommitState,
  SessionMessageStore,
  SessionStore,
} from "./types/store/SessionStore.js";
export type {
  FileSystem,
  WorkspaceDirectoryEntry,
} from "./types/workspace/FileSystem.js";
export type {
  WorkspaceOptions,
  WorkspaceResources,
} from "./types/workspace/Workspace.js";
export { RemoteAgent } from "./remote/RemoteAgent.js";
export { Session } from "./session/Session.js";
export type { SessionOptions } from "./types/session/SessionOptions.js";
export {
  inferAgentModelLabel,
  normalizeAgentModel,
  read_agent_model_context_window,
} from "./agent/AgentModel.js";
export type { AgentModel } from "./agent/AgentModel.js";
export type {
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentCreateSessionInput,
  AgentListSessionsInput,
  AgentSessionConfigSnapshot,
  AgentSessionForkInput,
  AgentSessionInfo,
  AgentSessionSetInput,
  AgentSessionSummary,
  AgentSessionSummaryPage,
  AgentSessionSystemBlock,
  AgentSessionSystemBlockSource,
  AgentSessionSystemSessionInfo,
  AgentSessionSystemSnapshot,
} from "./types/agent/SessionTypes.js";
export type {
  ListSessionMessagesInput,
  SessionActionMessage,
  SessionAssistantDataPart,
  SessionAssistantDocumentSourcePart,
  SessionAssistantFilePart,
  SessionAssistantMessage,
  SessionAssistantMessagePart,
  SessionAssistantSourcePart,
  SessionAssistantStepPart,
  SessionAssistantTextPart,
  SessionAssistantToolPart,
  SessionAssistantUrlSourcePart,
  SessionErrorMessage,
  SessionMessage,
  SessionMessagePage,
  SessionUserDataPart,
  SessionUserFilePart,
  SessionUserMessage,
  SessionUserMessagePart,
  SessionUserTextPart,
  SessionToolApprovalSnapshot,
} from "./types/session/SessionMessage.js";
export type {
  SessionContextSnapshot,
  SessionMessageStorageStats,
  SessionSegmentRange,
  SessionSegmentSnapshot,
  SessionSegmentSummary,
} from "./types/session/SessionSegment.js";
export {
  is_session_mutation,
} from "./types/session/SessionMutation.js";
export type {
  SessionDeltaMutation,
  SessionMessageMutation,
  SessionMutation,
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
  SessionPartMutation,
  SessionStateMutation,
  SessionTurnMutation,
} from "./types/session/SessionMutation.js";
export type {
  ResolveSessionApprovalInput,
  SessionApproval,
  SessionApprovalDecision,
  SessionApprovalMode,
  SessionApprovalModeSnapshot,
  SessionApprovalResult,
  SetSessionApprovalModeInput,
} from "./types/session/SessionApproval.js";
export type {
  AgentOptions,
  AgentSessionConstructor,
} from "./types/agent/AgentOptions.js";
export type {
  AgentSession,
  AgentSessionActor,
  AgentSessions,
  RemoteAgentSession,
} from "./types/agent/SessionActor.js";
export type { AgentManagedSession } from "./types/session/SessionOptions.js";
export type { RemoteAgentOptions } from "./types/agent/RemoteAgentOptions.js";
export type {
  RemoteAgentPluginActionInput,
  RemoteAgentPluginActionResult,
} from "./types/agent/RemoteAgentPluginAction.js";
export type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
  AgentSessionActionRecord,
  AgentSessionActionState,
} from "./types/sdk/AgentSessionAction.js";
export type { AgentSessionPromptInput } from "./types/sdk/AgentSessionPrompt.js";
export type { AgentSessionStopResult } from "./types/sdk/AgentSessionStop.js";
export type {
  AgentSessionTurnHandle,
  AgentSessionTurnResult,
} from "./types/sdk/AgentSessionTurn.js";
export { AgentContext } from "./agent/AgentContext.js";
export type { SessionPort } from "./types/session/SessionPort.js";
export type { StructuredConfig } from "./types/plugin/PluginConfig.js";

// Plugin 作者 API
export { BasePlugin } from "./plugin/core/BasePlugin.js";
export {
  createAction,
  createPlugin,
} from "./plugin/core/PluginActionFactory.js";
export type {
  CreatePluginActionOptions,
  CreatePluginOptions,
} from "./plugin/core/PluginActionFactory.js";

// Session 与即时执行集成
export { Executor } from "./executor/Executor.js";
export { DefaultSessionComposer } from "./session/DefaultSessionComposer.js";
export { SessionMessages } from "./session/SessionMessages.js";
export { JsonlSessionMessageStore } from "./session/messages/JsonlSessionMessageStore.js";
export type {
  AppendCompletedAssistantMessageInput,
  AppendExternalSessionAssistantMessageInput,
  AppendExternalSessionUserMessageInput,
  AppendSessionErrorMessageInput,
  AppendSessionPromptMessageInput,
  AppendSessionUserMessageInput,
  OpenSessionActionMessageInput,
  OpenSessionAssistantMessageInput,
  SessionMessagesOptions,
} from "./types/session/SessionMessages.js";
export type {
  SessionComposer,
  SessionCompactionInput,
  SessionCompactionPlan,
  SessionComposeIdentity,
  SessionComposeInput,
  SessionComposeState,
  SessionComposeTurn,
  SessionStepInput,
} from "./types/session/SessionComposer.js";
export { DefaultSessionSystemComposer } from "./executor/composer/system/default/DefaultSessionSystemComposer.js";
export { resolveSessionSystemMessages } from "./executor/composer/system/default/SystemDomain.js";
export type { SessionExecutor } from "./executor/types/SessionExecutor.js";
export type {
  SessionAssistantStepCallback,
  SessionRunResult,
} from "./executor/types/SessionRun.js";
export type { SessionRunContext } from "./types/executor/SessionRunContext.js";
export type { SessionToolExecutionContext } from "./types/executor/SessionToolExecutionContext.js";
export type { PluginRunContext } from "./types/plugin/PluginRunContext.js";
export type {
  SessionActionRecordV1,
  SessionMessageRecordV1,
  SessionMetadataV1,
  SessionRecordV1,
  SessionUserMessageV1,
} from "./executor/types/SessionRecords.js";
export {
  is_session_action_record,
  is_session_message_record,
} from "./executor/types/SessionRecords.js";
export type { SessionSystemMessage } from "./executor/types/SessionPrompts.js";
export { transformPromptsIntoSystemMessages } from "./executor/composer/system/default/PromptRenderer.js";
// 通用 plugin 宿主工具
export {
  buildStaticPluginAvailability,
  findPluginByName,
  hasPluginLifecycle,
  listPluginViews,
  listPluginsWithLifecycle,
  listPluginsWithoutLifecycle,
  resolvePluginAvailability,
  toPluginView,
} from "./plugin/core/PluginCatalog.js";
export {
  listPluginAuthPolicies,
  registerPluginHttpRoutes,
} from "./plugin/core/PluginHttpRoutes.js";
export {
  createLocalPluginCommandContext,
  getLocalPluginAvailability,
  runLocalPluginAction,
} from "./plugin/core/PluginLocalExecution.js";
export {
  registerPluginActionCommandsForCli,
} from "./plugin/core/PluginCommand.js";

// Runtime plugin 调度集成
export { ActionScheduleStore } from "./plugin/core/ActionScheduleStore.js";
export { parseActionScheduleRunAtMsOrThrow } from "./plugin/core/ActionScheduleTime.js";
export {
  pickLastSuccessfulChatSendText,
  resolveAssistantMessageForPersistence,
} from "./executor/messages/UserVisibleText.js";
export { extractToolCallsFromUiMessage } from "./executor/messages/UIMessageTransformer.js";
export {
  buildChatMessageText,
  parseChatMessageMarkup,
  renderChatMessageFileTag,
} from "./executor/messages/ChatMessageMarkup.js";
export type {
  ChatMessageFileTag,
  ChatMessageFileType,
  ChatMessageSegment,
  ChatMessageSendOptions,
} from "./executor/messages/ChatMessageMarkupTypes.js";

// 项目与配置集成
export {
  initializeAgentProject,
  normalizeDefaultAgentId,
} from "./config/AgentInitializer.js";
export {
  load_project_dotenv,
  resolve_agent_env,
} from "./config/AgentEnv.js";
export { getDowncitySessionMessagesPath } from "./config/Paths.js";
export {
  getPlatformStoreDbPath,
  getPlatformStoreKeyPath,
} from "./config/PlatformPaths.js";
export {
  ensureRuntimeProjectReady,
} from "./config/ProjectSetup.js";
export { assertProjectExecutionTarget } from "./config/ExecutionBinding.js";

// 日志
export { getLogger, type Logger } from "./utils/logger/Logger.js";
export { generateId } from "./utils/Id.js";
export {
  formatDateTimeInTimezone,
  resolveRuntimeTimezone,
} from "./utils/Time.js";

// 项目协议类型
export type {
  AgentProjectChannel,
  AgentProjectInitializationInput,
  AgentProjectInitializationResult,
} from "./types/config/AgentProject.js";
export type { ExecutionBindingConfig } from "./types/config/ExecutionBinding.js";

// 配置与模型类型
export type {
  DowncityChatChannelConfig,
  DowncityChatPluginChannelsConfig,
  DowncityChatPluginConfig,
  DowncityChatPluginQueueConfig,
  DowncityConfig,
  DowncityPluginConfigMap,
} from "./types/config/DowncityConfig.js";
export type {
  LlmConfig,
  LlmModelConfig,
  LlmProviderConfig,
  LlmProviderType,
} from "./types/config/LlmConfig.js";

// JSON 基础类型
export type { JsonObject, JsonPrimitive, JsonValue } from "./types/common/Json.js";

// Platform / city 控制面协议类型
export type {
  ControlPlaneRuntimeMeta,
  ControlPlaneRuntimeStatus,
  ManagedAgentProcessView,
  ManagedAgentRegistryEntry,
  ManagedAgentRegistryV1,
  PlatformAgentDirectoryInspection,
  PlatformAgentOption,
  PlatformAgentsResponse,
  PlatformConfigFileStatusItem,
  PlatformConfigStatusResponse,
  PlatformLocalModelsResponse,
} from "./types/runtime/platform/Platform.js";

export type {
  PlatformAgentChatChannelStatus,
} from "./types/runtime/platform/PlatformGateway.js";

// Inline instant 协议类型
export type {
  InlineInstantExecutorType,
  PlatformInlineInstantRunInput,
  PlatformInlineInstantRunResult,
  PlatformInlineInstantRunner,
} from "./types/runtime/http/InlineInstant.js";

// Plugin 作者与控制面类型
export type {
  PluginAction,
  PluginActionApi,
  PluginActionCommand,
  PluginActionCommandInput,
  PluginActionExample,
  PluginActionInputSchema,
  PluginActionMetadata,
  PluginActionResult,
  PluginActions,
  PluginActionInvokeParams,
  PluginActionInvokePort,
  PluginActionInvokeResult,
} from "./types/plugin/PluginAction.js";
export type { Plugin } from "./types/plugin/PluginDefinition.js";
export type {
  PluginCommandResult,
  PluginLifecycle,
} from "./types/plugin/PluginCommand.js";
export type {
  AgentPlugins,
  PluginAvailability,
  PluginConfigDefinition,
  PluginEffectHook,
  PluginGuardHook,
  PluginHooks,
  PluginPipelineHook,
  PluginResolves,
  PluginResolveHook,
  PluginView,
} from "./types/plugin/PluginRuntime.js";
export type {
  PluginHttpDefinition,
  PluginHttpRegistration,
} from "./types/plugin/PluginHttp.js";
export type {
  PluginSetupDefinition,
  PluginSetupField,
  PluginSetupFieldOption,
  PluginUsageDefinition,
  PluginUsageField,
  PluginUsageFieldOption,
} from "./types/plugin/PluginSetup.js";
export type {
  PluginActionResponse,
  PluginCatalogResponse,
  PluginAvailabilityResponse,
  PluginAvailabilityView,
} from "./plugin/types/PluginApi.js";

// 主动型 plugin 与 CLI/control 协议类型
export type { PluginState, PluginSnapshot } from "./types/plugin/PluginState.js";
export type {
  ActionScheduleJobRecord,
  ActionScheduleJobStatus,
  CreateActionScheduleJobInput,
  PluginActionScheduleInput,
} from "./plugin/types/ActionSchedule.js";
export type {
  PluginCliBaseOptions,
  PluginCommandResponse,
  PluginControlAction,
  PluginControlResponse,
  PluginStateListResponse,
} from "./types/plugin/PluginControl.js";
export type { PluginControlResult } from "./types/plugin/PluginState.js";
export {
  controlPluginState,
  listPluginStates,
} from "./plugin/core/PluginStateController.js";
export { runPluginCommand } from "./plugin/core/PluginActionRunner.js";
export { parsePluginCommandRequestBody } from "./plugin/core/PluginCommandRequest.js";

// 跨包 RPC 与 session 标识协议
export type {
  RpcEventFrame,
  RpcRequest,
  RpcServerFrame,
} from "./types/rpc/RpcProtocol.js";
export { resolveSessionId } from "./executor/ids/resolveSessionId.js";

// Platform store 类型
export type {
  StoredChannelAccount,
  StoredChannelAccountChannel,
  StoredEnvEntry,
  StoredGlobalEnvEntry,
  UpsertChannelAccountInput,
  UpsertEnvEntryInput,
  UpsertGlobalEnvEntryInput,
} from "./types/platform/Store.js";

// HTTP auth 协议类型
export {
  AUTH_DEFAULT_ROLE_NAMES,
  AUTH_DEFAULT_ROLES,
  AUTH_PERMISSION_DESCRIPTIONS,
  AUTH_PERMISSION_KEYS,
} from "./types/runtime/auth/AuthPermission.js";
export type {
  AuthDefaultRoleDefinition,
  AuthDefaultRoleName,
  AuthPermissionKey,
} from "./types/runtime/auth/AuthPermission.js";
export type { AuthRoutePolicy } from "./types/runtime/auth/AuthRoute.js";
export type {
  AuthIssuedToken,
  AuthTokenSummary,
} from "./types/runtime/auth/AuthToken.js";
export type {
  AuthAuditLog,
  AuthPermission,
  AuthPrincipal,
  AuthRole,
  AuthTokenRecord,
  AuthUser,
  AuthUserStatus,
} from "./types/runtime/auth/AuthTypes.js";
