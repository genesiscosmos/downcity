/**
 * Session 导航索引领域 store。
 *
 * 承载按 Workspace 分组的 Agent Session、已归档 Session 与 GroupSession 导航索引。
 * 只保存导航所需的摘要（title / updated_at / executing 等），不承载消息内容。
 */

import { useCallback, useMemo } from "react";
import type {
  DesktopGroupSummary,
  DesktopGroupSessionSummary,
  DesktopSessionSummary,
} from "@common/types/DesktopApi";
import type { DesktopWorkspaceGroupSession, DesktopWorkspaceSession, SessionAttachRequest, SessionStoreState } from "@/types/DesktopView";
import { use_store } from "./store_types";

const initial_session_state: SessionStoreState = {
  sessions_by_workspace: {},
  group_sessions_by_workspace: {},
  archived_sessions_by_workspace: {},
  session_attach_request: null,
};

/** 创建 Session 导航索引领域 store。 */
export function use_session_store() {
  const { store, state_ref, commit } = use_store<SessionStoreState>(initial_session_state);

  /** 移除一个 Workspace 的全部导航索引（含归档）。 */
  const remove_workspace = useCallback((workspace_id: string) => {
    const current = state_ref.current;
    const next_sessions = remove_workspace_key(current.sessions_by_workspace, workspace_id);
    const next_group_sessions = remove_workspace_key(current.group_sessions_by_workspace, workspace_id);
    const next_archived = remove_workspace_key(current.archived_sessions_by_workspace, workspace_id);
    if (next_sessions === current.sessions_by_workspace && next_group_sessions === current.group_sessions_by_workspace && next_archived === current.archived_sessions_by_workspace) return;
    commit({
      ...current,
      sessions_by_workspace: next_sessions,
      group_sessions_by_workspace: next_group_sessions,
      archived_sessions_by_workspace: next_archived,
    });
  }, [commit]);

  /** 将一个 Agent Session 置顶插入（或替换）指定 Workspace 分组。 */
  const prepend_session = useCallback((workspace_id: string, agent_id: string, session: DesktopSessionSummary) => {
    const current = state_ref.current;
    const entries = current.sessions_by_workspace[workspace_id] ?? [];
    const filtered = entries.filter(
      (item) => item.agent_id !== agent_id || item.session.session_id !== session.session_id,
    );
    commit({
      ...current,
      sessions_by_workspace: {
        ...current.sessions_by_workspace,
        [workspace_id]: [{ agent_id, session }, ...filtered],
      },
    });
  }, [commit]);

  /** 移除一个 Agent Session 的导航条目。 */
  const remove_session = useCallback((workspace_id: string, agent_id: string, session_id: string) => {
    const current = state_ref.current;
    commit({
      ...current,
      sessions_by_workspace: remove_workspace_session(current.sessions_by_workspace, workspace_id, agent_id, session_id),
    });
  }, [commit]);

  /** 批量替换一个 Workspace 的 Agent Session 导航列表。 */
  const set_workspace_sessions = useCallback((workspace_id: string, entries: DesktopWorkspaceSession[]) => {
    const current = state_ref.current;
    if (Object.is(current.sessions_by_workspace[workspace_id], entries)) return;
    commit({
      ...current,
      sessions_by_workspace: { ...current.sessions_by_workspace, [workspace_id]: entries },
    });
  }, [commit]);

  /** 批量替换整体 Session 导航索引（首次加载 / 全量刷新时使用）。 */
  const replace_all_sessions = useCallback((sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>) => {
    const current = state_ref.current;
    if (Object.is(current.sessions_by_workspace, sessions_by_workspace)) return;
    commit({ ...current, sessions_by_workspace });
  }, [commit]);

  /** 移除指定 Agent 在全部 Workspace 下的 Session 导航条目。 */
  const remove_agent_sessions = useCallback((agent_id: string) => {
    const current = state_ref.current;
    const next_sessions = filter_agent_from_entries(current.sessions_by_workspace, agent_id);
    const next_archived = filter_agent_from_entries(current.archived_sessions_by_workspace, agent_id);
    if (next_sessions === current.sessions_by_workspace && next_archived === current.archived_sessions_by_workspace) return;
    commit({ ...current, sessions_by_workspace: next_sessions, archived_sessions_by_workspace: next_archived });
  }, [commit]);

  /** 缓存指定 Workspace 的已归档 Session 列表。 */
  const set_archived_sessions = useCallback((workspace_id: string, entries: DesktopWorkspaceSession[]) => {
    const current = state_ref.current;
    if (Object.is(current.archived_sessions_by_workspace[workspace_id], entries)) return;
    commit({
      ...current,
      archived_sessions_by_workspace: { ...current.archived_sessions_by_workspace, [workspace_id]: entries },
    });
  }, [commit]);

  /** 将 GroupSession 导航投影替换为指定 Group 的当前 Session 集合。 */
  const replace_group_sessions = useCallback((group: DesktopGroupSummary) => {
    const current = state_ref.current;
    commit({
      ...current,
      group_sessions_by_workspace: index_group_sessions(upsert_group(current.group_sessions_by_workspace, group)),
    });
  }, [commit]);

  /** 移除指定 Group 的全部 GroupSession 导航投影。 */
  const remove_group_sessions = useCallback((group_id: string) => {
    const current = state_ref.current;
    commit({
      ...current,
      group_sessions_by_workspace: index_group_sessions(
        remove_group_from_index(current.group_sessions_by_workspace, group_id),
      ),
    });
  }, [commit]);

  /** 替换孤儿 Session 的 Workspace 绑定请求。 */
  const set_session_attach_request = useCallback((session_attach_request: SessionAttachRequest | null) => {
    if (Object.is(state_ref.current.session_attach_request, session_attach_request)) return;
    commit({ ...state_ref.current, session_attach_request });
  }, [commit]);

  return useMemo(() => ({
    store,
    state_ref,
    remove_workspace,
    prepend_session,
    remove_session,
    set_workspace_sessions,
    replace_all_sessions,
    remove_agent_sessions,
    set_archived_sessions,
    replace_group_sessions,
    remove_group_sessions,
    set_session_attach_request,
  }), [prepend_session, remove_agent_sessions, remove_group_sessions, remove_session, remove_workspace, replace_all_sessions, replace_group_sessions, set_archived_sessions, set_session_attach_request, set_workspace_sessions, state_ref, store]);
}

/** 从按 Workspace 分组的导航索引中移除一个 Workspace 键。 */
function remove_workspace_key<Value>(current: Record<string, Value[]>, workspace_id: string): Record<string, Value[]> {
  if (!(workspace_id in current)) return current;
  const next = { ...current };
  delete next[workspace_id];
  return next;
}

/** 从指定 Workspace 分组移除一个 Agent Session。 */
function remove_workspace_session(
  current: Record<string, DesktopWorkspaceSession[]>,
  workspace_id: string,
  agent_id: string,
  session_id: string,
): Record<string, DesktopWorkspaceSession[]> {
  const entries = current[workspace_id] ?? [];
  const filtered = entries.filter(
    (item) => item.agent_id !== agent_id || item.session.session_id !== session_id,
  );
  if (filtered.length === entries.length) return current;
  return { ...current, [workspace_id]: filtered };
}

/** 从全部 Workspace 分组移除指定 Agent 的条目；未变化时保留原引用。 */
function filter_agent_from_entries(
  current: Record<string, DesktopWorkspaceSession[]>,
  agent_id: string,
): Record<string, DesktopWorkspaceSession[]> {
  let changed = false;
  const next: Record<string, DesktopWorkspaceSession[]> = {};
  for (const [workspace_id, entries] of Object.entries(current)) {
    const filtered = entries.filter((item) => item.agent_id !== agent_id);
    if (filtered.length !== entries.length) changed = true;
    next[workspace_id] = filtered;
  }
  return changed ? next : current;
}

/** 将 Group 摘要合并进导航索引（按 group_id 去重）。 */
function upsert_group(
  current: Record<string, DesktopWorkspaceGroupSession[]>,
  group: DesktopGroupSummary,
): DesktopGroupSummary[] {
  const groups = new Map<string, DesktopGroupSummary>();
  for (const entry of Object.values(current).flat()) {
    if (entry.group.group_id !== group.group_id) groups.set(entry.group.group_id, entry.group);
  }
  groups.set(group.group_id, group);
  return [...groups.values()];
}

/** 从导航索引中移除指定 Group 的全部会话。 */
function remove_group_from_index(
  current: Record<string, DesktopWorkspaceGroupSession[]>,
  group_id: string,
): DesktopGroupSummary[] {
  const groups = new Map<string, DesktopGroupSummary>();
  for (const entry of Object.values(current).flat()) {
    if (entry.group.group_id !== group_id) groups.set(entry.group.group_id, entry.group);
  }
  return [...groups.values()];
}

/** 将 Group 摘要集合按 Workspace 建立 Sidebar 导航索引。 */
function index_group_sessions(groups: DesktopGroupSummary[]): Record<string, DesktopWorkspaceGroupSession[]> {
  const indexed: Record<string, DesktopWorkspaceGroupSession[]> = {};
  for (const group of groups) {
    for (const session of group.sessions) {
      if (!session.workspace_id) continue;
      (indexed[session.workspace_id] ??= []).push({ group_id: group.group_id, group, session });
    }
  }
  return indexed;
}
