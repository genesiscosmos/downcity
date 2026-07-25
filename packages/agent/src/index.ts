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
export { create_session_message_store } from "./workspace/store/SessionMessageStoreFactory.js";
export type {
  FileSystem,
  WorkspaceDirectoryEntry,
} from "./types/workspace/FileSystem.js";
export type { WorkspaceOptions } from "./types/workspace/Workspace.js";
export type {
  WorkspaceEnvPatch,
  WorkspaceEnvSubscriber,
  WorkspaceEnvUnsubscribe,
} from "./types/workspace/WorkspaceEnv.js";
export type { WorkspaceTools } from "./types/workspace/WorkspaceTools.js";
export { RemoteAgent } from "./remote/RemoteAgent.js";
export { Session } from "./session/Session.js";
export type { SessionOptions } from "./types/session/SessionOptions.js";
export {
  infer_agent_model_label,
  normalize_agent_model,
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
  AgentSessionTimelineEvent,
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
export { to_session_message_timeline_events } from "./session/browse/SessionMessageTimeline.js";
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
export type { PluginContext } from "./types/plugin/PluginContext.js";
export type { SessionPort } from "./types/session/SessionPort.js";
export type { StructuredConfig } from "./types/plugin/PluginConfig.js";

// Plugin 作者 API
export { BasePlugin } from "./plugin/core/BasePlugin.js";
export {
  create_action,
  create_plugin,
} from "./plugin/core/PluginActionFactory.js";
export type {
  CreatePluginActionOptions,
  CreatePluginOptions,
} from "./plugin/core/PluginActionFactory.js";

// Session 与即时执行集成
export { Executor } from "./executor/Executor.js";
export { DefaultSessionComposer } from "./session/DefaultSessionComposer.js";
export { SessionMessages } from "./session/SessionMessages.js";
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
export { resolve_session_system_messages } from "./executor/composer/system/default/SystemDomain.js";
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
export { transform_prompts_into_system_messages } from "./executor/composer/system/default/PromptRenderer.js";
// 通用 plugin 宿主工具
export {
  build_static_plugin_availability,
  find_plugin_by_name,
  has_plugin_lifecycle,
  list_plugin_views,
  list_plugins_with_lifecycle,
  list_plugins_without_lifecycle,
  resolve_plugin_availability,
  to_plugin_view,
} from "./plugin/core/PluginCatalog.js";
export {
  list_plugin_auth_policies,
  register_plugin_http_routes,
} from "./plugin/core/PluginHttpRoutes.js";
export {
  create_local_plugin_command_context,
  get_local_plugin_availability,
  run_local_plugin_action,
} from "./plugin/core/PluginLocalExecution.js";
export {
  register_plugin_action_commands_for_cli,
} from "./plugin/core/PluginCommand.js";

// Runtime plugin 调度集成
export { ActionScheduleStore } from "./plugin/core/ActionScheduleStore.js";
export { parse_action_schedule_run_at_ms_or_throw } from "./plugin/core/ActionScheduleTime.js";
export {
  pick_last_successful_chat_send_text,
  resolve_assistant_message_for_persistence,
} from "./executor/messages/UserVisibleText.js";
export { extract_tool_calls_from_ui_message } from "./executor/messages/UIMessageTransformer.js";
export {
  build_chat_message_text,
  parse_chat_message_markup,
  render_chat_message_file_tag,
} from "./executor/messages/ChatMessageMarkup.js";
export type {
  ChatMessageFileTag,
  ChatMessageFileType,
  ChatMessageSegment,
  ChatMessageSendOptions,
} from "./executor/messages/ChatMessageMarkupTypes.js";

// Workspace 环境集成
export {
  load_project_dotenv,
  resolve_workspace_env,
} from "./workspace/WorkspaceEnv.js";

// 日志
export { get_logger, type Logger } from "./utils/logger/Logger.js";
export { generate_id } from "./utils/Id.js";
export {
  format_date_time_in_timezone,
  resolve_runtime_timezone,
} from "./utils/Time.js";

// JSON 基础类型
export type { JsonObject, JsonPrimitive, JsonValue } from "./types/common/Json.js";

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
  control_plugin_state,
  list_plugin_states,
} from "./plugin/core/PluginStateController.js";
export { run_plugin_command } from "./plugin/core/PluginActionRunner.js";
export { parse_plugin_command_request_body } from "./plugin/core/PluginCommandRequest.js";

// 跨包 RPC 与 session 标识协议
export type {
  RpcEventFrame,
  RpcRequest,
  RpcServerFrame,
} from "./types/rpc/RpcProtocol.js";
export { resolve_session_id } from "./executor/ids/resolveSessionId.js";
