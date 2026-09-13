/**
 * Session 导航索引领域 store。
 *
 * 承载按 Workspace 分组的 Agent Session 与已归档 Session 导航索引。
 * 只保存导航所需的摘要（title / updated_at / executing 等），不承载消息内容。
 */

import { useCallback, useMemo } from "react";
import type { DesktopSessionSummary } from "@common/types/DesktopApi";
import type { DesktopWorkspaceSession, SessionAttachRequest, SessionStoreState } from "@/types/DesktopView";
import { use_store } from "@/lib/store";

const initial_session_state: SessionStoreState = {
  sessions_by_workspace: {},
  archived_sessions_by_workspace: {},
  session_attach_request: null,
  hydrated: false,
};

/** 创建 Session 导航索引领域 store。 */
export function use_session_store() {
  const { store, state_ref, commit } = use_store<SessionStoreState>(initial_session_state);

  /** 移除一个 Workspace 的全部 Agent Session 导航索引（含归档）。 */
  const remove_workspace = useCallback((workspace_id: string) => {
    const current = state_ref.current;
    const next_sessions = remove_workspace_key(current.sessions_by_workspace, workspace_id);
    const next_archived = remove_workspace_key(current.archived_sessions_by_workspace, workspace_id);
    if (next_sessions === current.sessions_by_workspace && next_archived === current.archived_sessions_by_workspace) return;
    commit({
      ...current,
      sessions_by_workspace: next_sessions,
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

  /** 标记 Session 目录已经完整加载过一次；成功与失败都要放行，否则侧栏会停在加载态。 */
  const mark_hydrated = useCallback(() => {
    if (state_ref.current.hydrated) return;
    commit({ ...state_ref.current, hydrated: true });
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
    set_session_attach_request,
    mark_hydrated,
  }), [mark_hydrated, prepend_session, remove_agent_sessions, remove_session, remove_workspace, replace_all_sessions, set_archived_sessions, set_session_attach_request, set_workspace_sessions, state_ref, store]);
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
