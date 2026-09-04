/**
 * @downcity/agent — Agent 运行时公开 API。
 *
 * 关键点（中文）
 * - 这是 agent 包核心运行时的稳定公开入口；可选 Tool 通过 `@downcity/agent/tools` 导出。
 * - 只导出 Agent SDK 与必要的 Session 协议类型。
 * - HTTP、RPC、Plugin、Workspace 与 Sandbox 实现不从根入口暴露。
 */

// Agent 入口
export { Agent } from "./agent/Agent.js";
export { Group } from "./group/Group.js";
export type {
  DispatchAssignment,
  DispatchDecision,
  DispatchGroupProfile,
  DispatchMemberProfile,
  DispatchStage,
  DispatchTrigger,
  DispatchStrategy,
  AiDispatchStrategyOptions,
  GroupContract,
  GroupMessage,
  GroupOptions,
} from "./group/index.js";
export type {
  GroupSessionDataStore,
  GroupSessionHistoryMeta,
  GroupSessionStore,
} from "./types/group/GroupSessionStore.js";
export type {
  GroupDispatchTurnRecord,
  GroupDispatchTurnStatus,
} from "./types/group/GroupDispatch.js";
export { GroupSession, GroupSessions } from "./group/index.js";
export type {
  GroupMemberRuntime,
  GroupEvent,
  GroupStatusPhase,
  GroupEventSubscriber,
  GroupEventUnsubscribe,
  GroupPromptInput,
  GroupPromptResult,
  GroupSessionContract,
  GroupSessionCreateInput,
  GroupSessionGetInput,
  GroupSessionListInput,
  GroupSessionSummary,
  GroupSessionsContract,
} from "./group/index.js";
export { AiDispatchStrategy } from "./group/index.js";
export type { SessionStore } from "./types/store/SessionStore.js";
export type {
  CompactActiveMessagesInput,
  CompactActiveMessagesResult,
  SessionMessageCommitState,
  SessionMessageStore,
  SessionDataStore,
} from "./types/store/SessionDataStore.js";
export type { SessionAttachmentStore } from "./types/store/SessionAttachmentStore.js";
export { create_session_message_store } from "./workspace/store/SessionMessageStoreFactory.js";
export type { AgentStorage } from "./types/agent/AgentStorage.js";
export { Session } from "./session/Session.js";
export type { SessionOptions } from "./types/session/SessionOptions.js";
export type { SessionOrigin } from "./types/session/SessionOrigin.js";
export { SESSION_EXTENSION_POINTS } from "./session/SessionExtensionPoints.js";
export type {
  SessionCommittedTurnStatus,
  SessionExtensionContextBlock,
  SessionExtensionUserMessage,
  SessionSystemContextHookValue,
  SessionTurnCommittedHookValue,
  SessionTurnContextHookValue,
} from "./types/session/SessionExtensionHook.js";
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
  AgentSessionSecurityConfig,
  AgentSessionSecurityStatus,
  AgentSessionSetInput,
  AgentSessionSetOptions,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentSessionSummaryPage,
  AgentSessionSystemBlock,
  AgentSessionSystemBlockSource,
  AgentSessionSystemSessionInfo,
  AgentSessionSystemSnapshot,
  AgentSessionTimelineEvent,
  RemoteSessionSetInput,
} from "./types/agent/SessionTypes.js";
export type {
  ListSessionMessagesInput,
  SessionActionMessage,
  SessionAssistantDataPart,
  SessionAssistantFilePart,
  SessionAssistantInteractionPart,
  SessionAssistantMessage,
  SessionAssistantMessagePart,
  SessionAssistantReasoningPart,
  SessionAssistantTextPart,
  SessionAssistantToolPart,
  SessionErrorMessage,
  SessionMessage,
  SessionMessagePage,
  SessionUserDataPart,
  SessionUserContextPart,
  SessionUserFilePart,
  SessionUserMessage,
  SessionUserMessagePart,
  SessionUserTextPart,
} from "./types/session/SessionMessage.js";
export type {
  SessionTurnFileDiff,
  SessionTurnFileDiffData,
  SessionTurnFileDiffStatus,
} from "./types/session/SessionTurnFileDiff.js";
export {
  is_session_turn_file_diff_data_part,
  read_session_turn_file_diff_data,
  SESSION_TURN_FILE_DIFF_DATA_TYPE,
} from "./session/messages/SessionTurnFileDiffData.js";
export { to_session_message_timeline_events } from "./session/browse/SessionMessageTimeline.js";
export { SessionAssistantOutputAdapter } from "./session/execution/SessionAssistantOutputAdapter.js";
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
  SessionCompactMutation,
  SessionConfigMutation,
  SessionDeltaMutation,
  SessionMessageMutation,
  SessionMutation,
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
  SessionPartMutation,
  SessionStateMutation,
  SessionTitleMutation,
  SessionTurnMutation,
} from "./types/session/SessionMutation.js";
export type {
  RespondSessionInteractionInput,
  SessionApprovalMode,
  SessionCancelledInteractionResult,
  SessionExpiredInteractionResult,
  SessionInteractionAnswer,
  SessionInteractionHandle,
  SessionInteractionLifecycle,
  SessionInteractionOption,
  SessionInteractionPort,
  SessionInteractionQuestion,
  SessionInteractionQuestionResponseType,
  SessionInteractionRequest,
  SessionInteractionResponse,
  SessionInteractionResult,
  SessionInteractionSource,
  SessionInteractionStatus,
  SessionPendingInteraction,
  SessionResolvedInteractionResult,
} from "./types/session/SessionInteraction.js";
export type {
  AgentOptions,
  AgentSessionConstructor,
} from "./types/agent/AgentOptions.js";
export type {
  AgentCreateSessionOptions,
  AgentSessionCollection,
} from "./types/agent/AgentSessionCollection.js";
export type {
  AgentSession,
  AgentSessionActor,
  AgentSessions,
  RemoteAgentSession,
} from "./types/agent/SessionActor.js";
export type { AgentManagedSession } from "./types/session/SessionOptions.js";
export type {
  AgentSessionActionCallback,
  AgentSessionActionEvent,
  AgentSessionActionRecord,
  AgentSessionActionState,
} from "./types/sdk/AgentSessionAction.js";
export type { AgentSessionPromptInput } from "./types/sdk/AgentSessionPrompt.js";
export { is_agent_session_prompt_input_empty } from "./types/sdk/AgentSessionPrompt.js";
export type {
  SessionPromptPart,
  SessionAssistantResultPart,
  SessionTextInputPart,
  SessionContextInputPart,
  SessionFileInputPart,
  SessionDataInputPart,
} from "./types/session/SessionContent.js";
export type { AgentSessionStopResult } from "./types/sdk/AgentSessionStop.js";
export type {
  AgentSessionTurnHandle,
  AgentSessionTurnResult,
} from "./types/sdk/AgentSessionTurn.js";
export type {
  AgentSessionCompactHandle,
  AgentSessionCompactReason,
  AgentSessionCompactResult,
} from "./types/sdk/AgentSessionCompact.js";
export type { SessionPort } from "./types/session/SessionPort.js";
export type {
  ActionResult,
  ActionResultMessage,
} from "./types/action/ActionResult.js";

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
export type {
  SessionExecutor,
  SessionTurnExecutionResult,
} from "./types/session/SessionExecution.js";
export { create_session_turn_context } from "./session/runtime/SessionTurnContext.js";
export type {
  SessionTurnContext,
  SessionTurnContextInit,
} from "./types/executor/SessionTurnContext.js";
export type { SessionToolExecutionContext } from "./types/executor/SessionToolExecutionContext.js";
export type {
  ToolActionExecutionContext,
  ToolSessionExecutionScope,
} from "./types/tools/ToolActionExecutionContext.js";
export type {
  SessionActionEvent,
  SessionActionEventInput,
  SessionActionStatus,
} from "./types/session/SessionAction.js";
export type { SessionSystemMessage } from "./executor/types/SessionPrompts.js";
export { transform_prompts_into_system_messages } from "./executor/composer/system/default/PromptRenderer.js";
export {
  extract_session_message_text,
  extract_session_tool_calls,
  resolve_session_assistant_visible_text,
} from "./session/messages/SessionMessageText.js";
export type { SessionToolCallSummary } from "./session/messages/SessionMessageText.js";
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

// 日志
export { get_logger, type Logger } from "./utils/logger/Logger.js";
export { generate_id } from "./utils/Id.js";
export {
  format_date_time_in_timezone,
  resolve_runtime_timezone,
} from "./utils/Time.js";

// JSON 基础类型
export type { JsonObject, JsonPrimitive, JsonValue } from "./types/common/Json.js";

export { resolve_session_id } from "./executor/ids/resolveSessionId.js";
