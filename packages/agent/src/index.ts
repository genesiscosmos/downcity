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
export type { SessionAttachmentStore } from "./types/store/SessionAttachmentStore.js";
export type { AgentStorage } from "./types/agent/AgentStorage.js";
export { Session } from "./session/Session.js";
export { SessionHooks, SessionHookScope } from "./session/SessionHooks.js";
export type { SessionOptions } from "./types/session/SessionOptions.js";
export type { SessionOrigin } from "@downcity/type";
export { SESSION_HOOK_POINTS } from "./session/SessionHookPoints.js";
export type {
  SessionCommittedTurnStatus,
  SessionHookContextBlock,
  SessionHookUserMessage,
  SessionHookContext,
  SessionHookHandlers,
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
  SessionAgentActionPart,
  SessionAgentDataPart,
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
export { to_session_message_timeline_events } from "./session/browse/SessionMessageTimeline.js";
export { SessionAssistantOutputAdapter } from "./session/execution/SessionAssistantOutputAdapter.js";
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
  SessionApprovalMode,
  SessionCancelledInteractionResult,
  SessionInteractionAnswer,
  SessionInteractionHandle,
  SessionInteractionLifecycle,
  SessionInteractionOption,
  SessionInteractionPort,
  SessionInteractionQuestion,
  SessionInteractionQuestionType,
  SessionInteractionRequest,
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
export type {
  ActionResult,
  ActionResultMessage,
} from "./types/action/ActionResult.js";

// Session 与即时执行集成
export { Executor } from "./executor/Executor.js";
export { DefaultSessionComposer } from "./session/DefaultSessionComposer.js";
export { FullHistoryContextPolicy } from "./session/composer/policies/FullHistoryContextPolicy.js";
export { AdaptivePartContextPolicy } from "./session/composer/policies/AdaptivePartContextPolicy.js";
export { SessionMessages } from "./session/SessionMessages.js";
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
  SessionContextRecoveryInput,
  SessionStepInput,
} from "./types/session/SessionComposer.js";
export type {
  SessionContextPolicy,
  SessionContextPolicyInitializeInput,
  SessionContextPolicyInput,
  SessionContextPolicyRecoveryInput,
  SessionContextRecoveryReason,
  SessionResolvedContext,
  SessionResolvedContextDiagnostics,
} from "./types/session/SessionContextPolicy.js";
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
  SessionActionStatus,
} from "@downcity/type";
export type { SessionSystemMessage } from "./executor/types/SessionPrompts.js";
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
  format_date_in_timezone,
  format_date_time_in_timezone,
  resolve_runtime_timezone,
} from "./utils/Time.js";

// JSON 基础类型
export type { JsonObject, JsonPrimitive, JsonValue } from "@downcity/type";

export { resolve_session_id } from "./executor/ids/resolveSessionId.js";
