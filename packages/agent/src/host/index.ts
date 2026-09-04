/**
 * @downcity/agent/host — 上层组合根装配 Agent 的宿主协议。
 *
 * City 通过本入口连接 Agent、Workspace、Extension 执行视图与持久化资源。
 * Agent 核心不认识 City 的具体实现，依赖方向始终保持为 `city -> agent`。
 */

export type { AgentHost, AgentHostExtensions } from "@/types/agent/AgentHost.js";
export { WorkspaceEntry } from "@/agent/WorkspaceEntry.js";
export {
  attach_agent_host,
  attach_agent_storage,
  attach_agent_host_extensions,
  attach_agent_session_extensions,
  detach_agent_host,
  agent_embassy,
  extension_storage_scope,
  get_agent_storage,
  create_workspace_entry,
  get_workspace_entry,
} from "@/internal/AgentRuntime.js";
export {
  attach_group_storage,
  detach_group_storage,
} from "@/internal/GroupRuntime.js";
export type { AgentSessionCollection } from "@/types/agent/AgentSessionCollection.js";
export type { SessionExtensionRuntime } from "@downcity/type/session";
export { create_empty_session_extensions } from "@downcity/type/session";
export { Logger } from "@/utils/logger/Logger.js";
export { normalize_session_origin } from "@/session/SessionOrigin.js";
