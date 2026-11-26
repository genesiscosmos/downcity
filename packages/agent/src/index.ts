/**
 * @downcity/agent — Agent 运行时公开 API。
 *
 * 关键点（中文）
 * - 这是 agent 包核心运行时的稳定公开入口；可选 Tool 通过 `@downcity/agent/tools` 导出。
 * - 只导出 Agent SDK 与必要的 Session 协议类型。
 * - HTTP、RPC、Power、Workspace 与 Sandbox 实现不从根入口暴露。
 */

export { describe_prompt_powers, snapshot_prompt_powers, execute_prompt_power } from "./session/input/PromptPowers.js";
export type { PromptPower, PromptPowerAction, PromptPowerDescriptor, PromptPowerCallContext } from "@downcity/type";

export type { AgentBehavior } from "./types/agent/AgentBehavior.js";
export type {
  SessionExecutionProfile,
  SessionExecutionProfileContext,
  SessionExecutionProfileReference,
  SessionExecutionProfileResources,
  SessionExecutionProfileSelection,
} from "./types/agent/SessionExecutionProfile.js";

export { read_agent_pending_references, has_delivered_session_turn } from "./session/storage/AgentPendingReferences.js";
export type { AgentPendingReference } from "./session/storage/AgentPendingReferences.js";
/** 显式离线维护；调用方负责根独占维护权，不由会话生命周期自动触发。 */
export { cleanup_agent_session_attachments } from "./session/storage/agent-db/AgentAttachmentCleanup.js";
export type {
  AgentAttachmentCleanupInput,
  AgentAttachmentCleanupResult,
  AgentAttachmentCleanupFailure,
} from "./types/store/AgentAttachmentCleanup.js";
export type { SessionMetadataAddress, SessionMetadataResult } from "./types/agent/SessionMetadata.js";
export { AgentSessionBrowser } from "./session/storage/AgentSessionBrowser.js";
export { prepare_agent_session_storage } from "./session/storage/agent-db/AgentSessionPreparation.js";
/** 宿主只读门禁复用存储拥有者的版本与身份规则，不初始化或迁移数据库。 */
export { AGENT_SESSION_SCHEMA_VERSION, assert_agent_session_schema } from "./session/storage/agent-db/AgentSessionSchema.js";
export type { AgentSessionPreparationInput } from "./types/store/AgentSessionPreparation.js";
export type { AgentSessionBrowserOptions, AgentArchivedSessionAddress } from "./types/store/AgentSessionBrowser.js";
export type { SessionReadView } from "./types/store/SessionReadView.js";
export type { SessionReadConfiguration } from "./types/store/SessionReadConfiguration.js";
export type { SessionArchivedSnapshot } from "./types/store/SessionArchivedSnapshot.js";

// Agent 入口
export { Agent } from "./agent/Agent.js";
export { DeferredModelClient } from "./model/DeferredModelClient.js";
export { SessionBusyError } from "./session/SessionBusyError.js";
export type { SessionPromptActor } from "./types/sdk/SessionPromptActor.js";
export {
  create_runtime_prompt_actor,
  create_session_prompt_actor,
  create_user_prompt_actor,
  local_user_prompt_actor,
  session_prompt_actor_schema,
} from "./types/sdk/SessionPromptActor.js";
export type { SessionRemovalEvent } from "./types/agent/SessionRemoval.js";
export type { SessionCallback, SessionCallbackInput, SessionCallbackHandler, SessionCallbacks } from "./types/agent/SessionCallback.js";
export type { AgentWorkHost } from "./types/agent/AgentWorkHost.js";
export type { AgentVariables, AgentVariableValue } from "./types/agent/AgentVariables.js";
export type { SessionWorkContract } from "./types/agent/SessionWork.js";
export { bound_json, json_bytes, HISTORY_PAGE_MAX_BYTES } from "./model/messages/BoundedJson.js";
export type { SessionBackgroundInput, SessionBackgroundReceipt } from "./types/session/SessionBackgroundInput.js";
export type { SessionContextResolution } from "./types/agent/SessionContext.js";
export type {
  AgentSessionStateKey,
  AgentSessionStateValues,
  RemoteSessionStateKey,
  RemoteSessionStateValues,
} from "./types/agent/SessionState.js";
export type {
  SessionMessagesToolOutput,
  SessionArchiveToolOutput,
  SessionCheckDetailToolOutput,
  SessionCheckListToolOutput,
  SessionCheckToolOutput,
  SessionReplyToolOutput,
  SessionInputToolOutput,
  SessionStartToolOutput,
  SessionStopToolOutput,
  SessionToolState,
  SessionToolSummary,
} from "./types/tools/session/SessionTools.js";
export { Group } from "./group/Group.js";
export type {
  GroupDecisionModel,
  GroupDecisionInput,
  GroupDecisionResult,
  DispatchInput,
  DispatchDecision,
  DispatchGroupProfile,
  DispatchMemberProfile,
  DispatchMemberDecision,
  DispatchBooleanDecision,
  DispatchFactorDecision,
  DispatchTrigger,
  DispatchStrategy,
  DecisionDispatchStrategyOptions,
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
export { DecisionDispatchStrategy } from "./group/index.js";
export type { SessionStore } from "./types/store/SessionStore.js";
export type { SessionDerivedStore } from "./types/store/SessionStorage.js";
export type { SessionAttachmentStore } from "./types/store/SessionAttachmentStore.js";
export type { AgentStorage } from "./types/agent/AgentStorage.js";
export { Session } from "./session/Session.js";
export type { SessionDescriptor, SessionType, SessionParent, SessionCallContext } from "@downcity/type";
export { SESSION_HOOK_POINTS } from "@downcity/type";
export type {
  SessionCommittedTurnStatus,
  SessionExecutionStateHookValue,
  SessionHookContextBlock,
  SessionHookUserMessage,
  SessionSystemContextHookValue,
  SessionTurnCommittedHookValue,
  SessionTurnContextHookValue,
} from "@downcity/type";
export type {
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentCreateSessionInput,
  AgentListSessionsInput,
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
  SessionAgentActionPart,
  SessionAgentDataPart,
  SessionAgentViewPart,
  SessionAgentFilePart,
  SessionAgentInteraction,
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionAgentReasoningPart,
  SessionAgentTextPart,
  SessionAgentToolPart,
  SessionAgentErrorPart,
  SessionMessage,
  SessionMessagePage,
  SessionUserDataPart,
  SessionUserContextPart,
  SessionUserFilePart,
  SessionUserMessage,
  SessionUserMessagePart,
  SessionUserTextPart,
} from "@downcity/type";
export type {
  SessionTurnFileDiff,
  SessionTurnFileDiffData,
  SessionTurnFileDiffStatus,
  SessionTurnFileDiffSummary,
} from "@downcity/type";
export {
  is_session_turn_file_diff_data_part,
  read_session_turn_file_diff_data,
  SESSION_TURN_FILE_DIFF_DATA_TYPE,
} from "./session/messages/SessionTurnFileDiffData.js";
export { to_session_message_timeline_events } from "./session/messages/SessionMessageTimeline.js";
export { SessionAssistantOutputAdapter } from "./session/messages/SessionAssistantOutputAdapter.js";
export {
  is_session_mutation,
} from "@downcity/type";
export type {
  ModelRequestKind,
} from "@downcity/type";
export type {
  SessionConfigMutation,
  SessionDeltaMutation,
  SessionMessageMutation,
  SessionModelRequestWarningMutation,
  SessionMutation,
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
  SessionPartMutation,
  SessionStateMutation,
  SessionTitleMutation,
  SessionTurnFileDiffMutation,
  SessionTurnMutation,
} from "@downcity/type";
export type {
  RespondSessionInteractionInput,
  SessionApprovalDecision,
  SessionApprovalMode,
  SessionApprovalPort,
  SessionApprovalRequestInput,
  SessionCancelledInteractionResult,
  SessionInteractionAnswer,
  SessionInteractionHandle,
  SessionInteractionLifecycle,
  SessionInteractionOption,
  SessionInteractionPort,
  SessionInteractionQuestion,
  SessionInteractionQuestionType,
  SessionInteractionRequest,
  SessionInteractionRequestInput,
  SessionInteractionResponse,
  SessionInteractionResult,
  SessionInteractionSource,
  SessionInteractionStatus,
  SessionResolvedInteractionResult,
} from "@downcity/type";
export { SESSION_APPROVAL_RESPONSE_SCHEMA } from "@downcity/type";
export type {
  AgentOptions,
  AgentSessionConstructor,
} from "./types/agent/AgentOptions.js";
export type { AgentReconfigureInput } from "./types/agent/AgentReconfigureInput.js";
export type {
  AgentInteraction,
  AgentInteractionChange,
  AgentInteractionCollection,
  AgentInteractionReference,
  AgentListInteractionsInput,
  AgentRespondInteractionInput,
} from "./types/agent/AgentInteractions.js";
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
} from "./types/sdk/AgentSessionAction.js";
export type {
  AgentSessionPromptContent,
  AgentSessionPromptInput,
} from "./types/sdk/AgentSessionPrompt.js";
export { is_agent_session_prompt_input_empty } from "./types/sdk/AgentSessionPrompt.js";
export type {
  SessionAgentContent,
  SessionContextContent,
  SessionDataContent,
  SessionFileContent,
  SessionModelUserContent,
  SessionTextContent,
  SessionUserContent,
} from "@downcity/type";
export type { AgentSessionStopResult } from "./types/sdk/AgentSessionStop.js";
export type {
  AgentSessionTurnHandle,
  AgentSessionTurnResult,
} from "./types/sdk/AgentSessionTurn.js";
export type { SessionPort } from "./types/session/SessionPort.js";
export {
  is_action_result,
  type ActionResult,
  type ActionResultMessage,
  type SessionSystemMessage,
} from "@downcity/type";

// Session 与即时执行集成
export { SessionExecutor } from "./session/runner/SessionExecutor.js";
export { DefaultSessionComposer } from "./session/input/composer/DefaultSessionComposer.js";
export { FullHistorySessionComposer } from "./session/input/composer/FullHistorySessionComposer.js";
export { SessionMessages } from "./session/messages/SessionMessages.js";
export type {
  AppendExternalSessionAgentMessageInput,
  AppendExternalSessionUserMessageInput,
  AppendSessionAgentErrorPartInput,
  AppendSessionPromptMessageInput,
  AppendSessionUserMessageInput,
  OpenSessionAgentMessageInput,
  SessionMessagesOptions,
} from "./types/session/SessionMessages.js";
export type {
  SessionComposer,
  SessionComposeIdentity,
  SessionComposeInput,
  SessionComposeState,
  SessionComposeTurn,
  SessionComposerInitializeInput,
  SessionContextAdvanceInput,
  SessionContextAdvanceTrigger,
  SessionContextDiagnostics,
  SessionStepInput,
} from "./types/session/SessionComposer.js";
export type {
  SessionTurnExecutionResult,
} from "./types/session/SessionExecution.js";
export { create_session_turn_context } from "./session/loop/SessionTurnContext.js";
export type {
  SessionTurnContext,
  SessionTurnContextInit,
} from "./types/turn/SessionTurnContext.js";
export type { SessionActionEvent, SessionActionStatus } from "@downcity/type";
export {
  extract_session_message_text,
  extract_session_tool_calls,
  resolve_session_assistant_visible_text,
} from "./session/messages/SessionMessageText.js";
export type { SessionToolCallSummary } from "./session/messages/SessionMessageText.js";
export {
  build_chat_message_text,
  extract_chat_message_file_tags,
  parse_chat_message_markup,
  render_chat_message_file_tag,
} from "./model/messages/ChatMessageMarkup.js";
export type {
  ChatMessageFileTag,
  ChatMessageFileType,
  ChatMessageSegment,
  ChatMessageSendOptions,
} from "./model/messages/ChatMessageMarkupTypes.js";

// 日志
export { get_logger, type Logger } from "./utils/logger/Logger.js";
export { generate_id } from "./utils/Id.js";
export {
  format_date_in_timezone,
  format_date_time_in_timezone,
  resolve_runtime_timezone,
} from "./utils/Time.js";

// JSON 基础类型
export type { JsonObject, JsonPrimitive, JsonValue } from "@downcity/type";

export { resolve_session_id } from "./utils/ResolveSessionId.js";
