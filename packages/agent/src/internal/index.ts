/**
 * @downcity/agent/internal
 *
 * Agent 运行时内部协议。应用代码不应依赖此入口；它不属于 SDK 公共领域 API。
 */
export {
  initialize_agent_runtime,
  bind_agent_runtime,
  unbind_agent_runtime,
  agent_runtime_binding,
  ensure_agent_runtime_ready,
  agent_has_resource_container,
  release_agent_from_container,
  resolve_agent_session_hooks,
  agent_storage_scope,
  plugin_storage_scope,
  get_agent_storage,
  agent_storage,
  create_workspace_entry,
  get_workspace_entry,
  list_workspace_entries,
  release_workspace_entry,
  clear_agent_runtime,
  dispose_agent_runtime,
} from "@/internal/AgentRuntime.js";
export { WorkspaceEntry } from "@/agent/WorkspaceEntry.js";
export type { AgentRuntimeBinding } from "@/types/agent/AgentRuntimeBinding.js";
export { SessionHooks, SessionHookScope, EMPTY_SESSION_HOOKS } from "@/session/SessionHooks.js";
export type { SessionHookContext, SessionHookHandlers } from "@/types/session/SessionHook.js";
export { normalize_session_origin } from "@/session/SessionOrigin.js";
export {
  initialize_group_runtime,
  attach_group_storage,
  detach_group_storage,
  get_group_session_store,
  mark_group_session_started,
  dispose_group_runtime,
} from "@/internal/GroupRuntime.js";
