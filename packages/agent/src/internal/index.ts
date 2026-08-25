/**
 * @downcity/agent/internal
 *
 * Agent 运行时内部协议。应用代码不应依赖此入口；它不属于 SDK 公共领域 API。
 */
export {
  initialize_agent_runtime,
  attach_agent_city,
  detach_agent_city,
  agent_city,
  agent_is_in_city,
  agent_storage_scope,
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
