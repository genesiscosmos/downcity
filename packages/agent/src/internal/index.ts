/**
 * @downcity/agent/internal
 *
 * Agent 运行时内部协议。应用代码不应依赖此入口；它不属于 SDK 公共领域 API。
 */
export {
  initialize_agent_runtime,
  attach_agent_city,
  attach_agent_storage,
  detach_agent_city,
  agent_is_in_city,
  agent_embassy,
  release_agent_from_city,
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
  ensure_agent_action_schedule,
} from "@/internal/AgentRuntime.js";
export {
  initialize_group_runtime,
  attach_group_storage,
  detach_group_storage,
  get_group_session_store,
  mark_group_session_started,
  dispose_group_runtime,
} from "@/internal/GroupRuntime.js";
