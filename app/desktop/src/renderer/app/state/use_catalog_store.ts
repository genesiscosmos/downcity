/**
 * Catalog 领域 store（低频列表）。
 *
 * 承载共享 Registry 的 Agent / Workspace / Group / Plugin 摘要，以及
 * Federation 模型目录。全部为低频列表数据，不做高频流式更新。
 */

import { useCallback, useMemo } from "react";
import type { DesktopAgentSummary, DesktopGroupSummary, DesktopModelSummary, DesktopPluginSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { CatalogStoreState } from "@/types/DesktopView";
import { use_store } from "@/lib/store";

const initial_catalog_state: CatalogStoreState = {
  agents: [],
  workspaces: [],
  groups: [],
  groups_by_id: {},
  plugins: [],
  models: [],
  models_loading: false,
};

/** 创建 Catalog 领域 store。 */
export function use_catalog_store() {
  const { store, state_ref, commit } = use_store<CatalogStoreState>(initial_catalog_state);

  /** 批量替换 Catalog 快照（首次并行加载时使用）。 */
  const replace_catalog = useCallback((patch: Partial<CatalogStoreState>) => {
    const current = state_ref.current;
    commit({ ...current, ...patch });
  }, [commit]);

  /** 替换 Agent 摘要列表。 */
  const set_agents = useCallback((agents: DesktopAgentSummary[]) => {
    if (Object.is(state_ref.current.agents, agents)) return;
    commit({ ...state_ref.current, agents });
  }, [commit]);

  /** 替换 Workspace 摘要列表。 */
  const set_workspaces = useCallback((workspaces: DesktopWorkspaceSummary[]) => {
    if (Object.is(state_ref.current.workspaces, workspaces)) return;
    commit({ ...state_ref.current, workspaces });
  }, [commit]);

  /** 替换 Group 摘要列表与按 ID 索引。 */
  const set_groups = useCallback((groups: DesktopGroupSummary[]) => {
    commit({
      ...state_ref.current,
      groups,
      groups_by_id: Object.fromEntries(groups.map((group) => [group.group_id, group])),
    });
  }, [commit]);

  /** 替换指定 Group 的摘要（同时更新按 ID 索引）。 */
  const upsert_group = useCallback((group: DesktopGroupSummary) => {
    const current = state_ref.current;
    const next_groups = current.groups.map((item) => (item.group_id === group.group_id ? group : item));
    const exists = current.groups.some((item) => item.group_id === group.group_id);
    const groups = exists ? next_groups : [...current.groups, group];
    commit({ ...current, groups, groups_by_id: { ...current.groups_by_id, [group.group_id]: group } });
  }, [commit]);

  /** 移除一个 Group 及其按 ID 索引。 */
  const remove_group = useCallback((group_id: string) => {
    const current = state_ref.current;
    const next_groups_by_id = { ...current.groups_by_id };
    delete next_groups_by_id[group_id];
    commit({
      ...current,
      groups: current.groups.filter((item) => item.group_id !== group_id),
      groups_by_id: next_groups_by_id,
    });
  }, [commit]);

  /** 替换 Plugin 摘要列表。 */
  const set_plugins = useCallback((plugins: DesktopPluginSummary[]) => {
    if (Object.is(state_ref.current.plugins, plugins)) return;
    commit({ ...state_ref.current, plugins });
  }, [commit]);

  /** 替换模型目录并更新加载态。 */
  const set_models = useCallback((models: DesktopModelSummary[], models_loading = false) => {
    if (Object.is(state_ref.current.models, models) && state_ref.current.models_loading === models_loading) return;
    commit({ ...state_ref.current, models, models_loading });
  }, [commit]);

  /** 单独更新模型目录加载态。 */
  const set_models_loading = useCallback((models_loading: boolean) => {
    if (state_ref.current.models_loading === models_loading) return;
    commit({ ...state_ref.current, models_loading });
  }, [commit]);

  /** 合并一个新的 Workspace（去重后追加）。 */
  const add_workspace = useCallback((workspace: DesktopWorkspaceSummary) => {
    const current = state_ref.current;
    const workspaces = [
      ...current.workspaces.filter((item) => item.workspace_id !== workspace.workspace_id),
      workspace,
    ];
    commit({ ...current, workspaces });
  }, [commit]);

  /** 替换指定 Workspace 的摘要。 */
  const replace_workspace = useCallback((workspace: DesktopWorkspaceSummary) => {
    const current = state_ref.current;
    commit({
      ...current,
      workspaces: current.workspaces.map((item) =>
        item.workspace_id === workspace.workspace_id ? workspace : item,
      ),
    });
  }, [commit]);

  /** 移除一个 Workspace（不存在则保留原引用）。 */
  const remove_workspace = useCallback((workspace_id: string) => {
    const current = state_ref.current;
    const filtered = current.workspaces.filter((item) => item.workspace_id !== workspace_id);
    if (filtered.length === current.workspaces.length) return;
    commit({ ...current, workspaces: filtered });
  }, [commit]);

  return useMemo(() => ({
    store,
    state_ref,
    replace_catalog,
    set_agents,
    set_workspaces,
    set_groups,
    upsert_group,
    remove_group,
    set_plugins,
    set_models,
    set_models_loading,
    add_workspace,
    replace_workspace,
    remove_workspace,
  }), [add_workspace, remove_group, remove_workspace, replace_catalog, replace_workspace, set_agents, set_groups, set_models, set_models_loading, set_plugins, set_workspaces, state_ref, store, upsert_group]);
}
