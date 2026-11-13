/** TUI 的目录/生命周期适配；业务走 ResourceClient，流式 actor 保留 SDK 的安全交互协议。 */
import type { AgentSessions, RemoteAgentSession, AgentSessionSummary } from "@downcity/agent";
import { ResourceError } from "@downcity/city/local";
import { recoverable_chat_session } from "./TurnRecovery.js";
import { ResourceClient } from "./ResourceClient.js";
import type { SessionCreateData, SessionGetData, SessionListData } from "./ResourceResults.js";

/** 把资源 DTO 的时间恢复为 SDK 视图，canonical 消息本身不经过此投影。 */
function sdk_summary(item: SessionListData["items"][number]): AgentSessionSummary {
  return { storage_id: item.storage_id, agent_id: item.agent_id, session_id: item.session_id, origin: item.origin, message_count: item.message_count,
    ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}), ...(item.title ? { title: item.title } : {}),
    ...(item.preview_text ? { preview_text: item.preview_text } : {}), ...(item.model_label ? { model_label: item.model_label } : {}),
    ...(item.created_at ? { created_at: Date.parse(item.created_at) } : {}), ...(item.updated_at ? { updated_at: Date.parse(item.updated_at) } : {}),
    ...(item.timezone ? { timezone: item.timezone } : {}), executing: item.runtime.state === "running" };
}

/** 目录切换仅由显式 Session 配置承担，打开详情先核对持久化 Workspace。 */
export function resource_chat_sessions(client: ResourceClient, agent_id: string, sdk: AgentSessions<RemoteAgentSession>, workspace_id?: string): AgentSessions<RemoteAgentSession> {
  const list = async (input: Parameters<AgentSessions<RemoteAgentSession>["list"]>[0], archived: boolean) => {
    const result = await client.call("session.list", { agent: agent_id, category: input?.category ?? "work", ...(workspace_id || input?.workspace_id ? { workspace: workspace_id ?? input?.workspace_id } : {}), ...(input?.limit !== undefined ? { limit: input.limit } : {}), ...(input?.cursor ? { cursor: input.cursor } : {}), ...(input?.query ? { query: input.query } : {}), ...(!archived && input?.origin_type ? { origin_type: input.origin_type } : {}), archived });
    const page = result.data as SessionListData;
    return { items: page.items.map(sdk_summary), total: page.total, has_more: page.has_more, ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}) };
  };
  return {
    create: async () => {
      if (!workspace_id) throw new ResourceError("usage_error", "Choose a registered Workspace before creating a Session", 2);
      const result = await client.call("session.create", { agent: agent_id, workspace: workspace_id });
      const created = (result.data as SessionCreateData).session;
      return recoverable_chat_session(await sdk.get(created.session_id, created.category), client, agent_id);
    },
    get: async (session_id, category = "work") => {
      const result = await client.call("session.get", { agent: agent_id, session_id, category });
      const session = (result.data as SessionGetData).session;
      if (session.archived) throw new ResourceError("dependency_conflict", "Archived history cannot execute", 4);
      if (workspace_id && session.workspace_id !== workspace_id) throw new ResourceError("dependency_conflict", "Persisted Session Workspace differs from this chat context", 4);
      const remote = await sdk.get(session_id, category);
      if (!session.model_binding?.override_model_id && session.saved_model_override) await remote.set({ model_id: session.saved_model_override }, { persist_action: false });
      return recoverable_chat_session(remote, client, agent_id);
    },
    list: async (input) => await list(input, false),
    archived: async (input) => await list(input, true),
    archive: async (input) => {
      const result = await client.call("session.archive", { agent: agent_id, session_id: input.id, category: input.category ?? "work", operation_id: input.operation_id, root_storage_id: input.root_storage_id });
      const data = result.data as Awaited<ReturnType<import("@downcity/city/local").ResourceService["sessions"]["archive"]>>;
      if (!data.root_result) throw new ResourceError("dependency_conflict", "Session was already archived; refresh the list", 4);
      return data.root_result;
    },
    read_archived: async storage_id => {
      const view = await sdk.read_archived(storage_id);
      if (workspace_id && view.metadata.workspace_id !== workspace_id) throw new ResourceError("dependency_conflict", "Archived Session belongs to another Workspace", 4);
      return view;
    },
    remove_archived: async storage_id => {
      const view = await sdk.read_archived(storage_id);
      if (workspace_id && view.metadata.workspace_id !== workspace_id) throw new ResourceError("dependency_conflict", "Archived Session belongs to another Workspace", 4);
      return await sdk.remove_archived(storage_id);
    },
    clean_archive: async () => { throw new ResourceError("capability_missing", "Permanent archive cleanup is not exposed by City resource management", 5); },
  };
}
