/**
 * @downcity/agent/internal
 *
 * Agent 运行时内部协议。应用代码不应依赖此入口；它不属于 SDK 公共领域 API。
 */
export {
  initialize_agent_runtime,
  attach_agent_host,
  attach_agent_storage,
  attach_agent_host_extensions,
  attach_agent_session_extensions,
  ensure_agent_extensions_ready,
  detach_agent_host,
  agent_has_host,
  agent_embassy,
  release_agent_from_host,
  agent_storage_scope,
  extension_storage_scope,
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
export type { AgentHost, AgentHostExtensions } from "@/types/agent/AgentHost.js";
export {
  initialize_group_runtime,
  attach_group_storage,
  detach_group_storage,
  get_group_session_store,
  mark_group_session_started,
  dispose_group_runtime,
} from "@/internal/GroupRuntime.js";
