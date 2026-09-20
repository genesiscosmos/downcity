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
export {
  normalize_session_origin,
  normalize_session_origin_type,
  restore_session_origin,
  type SessionOrigin,
} from "./types/session/SessionOrigin.js";
export type * from "./types/session/SessionContent.js";
export type * from "./types/session/SessionMessage.js";
export {
  CHAT_ENVIRONMENT_CONTEXT_TAG,
  CHAT_INFO_CONTEXT_TAG,
  CHAT_RUNTIME_CONTEXT_TAGS,
  is_chat_runtime_context_tag,
  type ChatRuntimeContextTag,
} from "./types/session/SessionUserContextTags.js";
export * from "./types/session/SessionInteraction.js";
export type * from "./types/session/SessionAction.js";
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
