/**
 * @downcity/type/session：Session 跨包数据协议入口。
 *
 * 这里同时导出 Session 领域类型与跨包共享的协议常量。
 */
export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
} from "./types/json/Json.js";
export * from "./types/session/SessionDescriptor.js";
export * from "./types/session/SessionCallContext.js";
export type * from "./types/session/SessionContent.js";
export { validate_session_view_content } from "./types/session/SessionViewContent.js";
export type * from "./types/session/SessionMessage.js";
export type * from "./types/session/SessionModelRetry.js";
export type * from "./types/session/SessionRuntime.js";
export {
  MESSENGER_ENVIRONMENT_CONTEXT_TAG,
  MESSENGER_INFO_CONTEXT_TAG,
  MESSENGER_RUNTIME_CONTEXT_TAGS,
  is_messenger_runtime_context_tag,
  type MessengerRuntimeContextTag,
} from "./types/session/SessionUserContextTags.js";
export * from "./types/session/SessionInteraction.js";
export type * from "./types/session/SessionAction.js";
export { SESSION_HOOK_POINTS } from "./types/session/SessionHookPoints.js";
export {
  is_action_result,
  type ActionResult,
  type ActionResultMessage,
  type SessionSystemMessage,
} from "./types/session/SessionActionContract.js";
export type * from "./types/session/SessionTurnFileDiff.js";
export * from "./types/session/SessionMutation.js";
export type {
  SessionSystemBlock,
  SessionSystemBlockSource,
} from "./types/session/SessionSystem.js";
export type * from "./types/session/SessionHook.js";
export type {
  ToolCallContext,
  ToolCallUserMessage,
} from "./types/session/ToolCallContext.js";
