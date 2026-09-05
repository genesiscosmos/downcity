/**
 * 导航领域 store。
 *
 * 承载主视图 selection / 一级 Sidebar 模式 / 当前 Workspace 上下文，
 * 以及功能型 Plugin 的 Sidebar 与 Mainview 共享路由。只做导航，不承载业务数据。
 */

import { useCallback, useMemo } from "react";
import type { PluginJsonObject } from "@downcity/city/plugin";
import type { NavigationStoreState, NavigationTarget, SidebarMode } from "@/types/DesktopView";
import { use_store } from "@/lib/store";

const initial_navigation_state: NavigationStoreState = {
  selection: null,
  sidebar_mode: "chat",
  active_workspace_id: "",
  plugin_routes: {},
  plugin_revisions: {},
};

/** 创建导航领域 store。 */
export function use_navigation_store() {
  const { store, state_ref, commit } = use_store<NavigationStoreState>(initial_navigation_state);

  /** 替换当前导航目标。 */
  const set_selection = useCallback((selection: NavigationTarget | null) => {
    if (Object.is(state_ref.current.selection, selection)) return;
    commit({ ...state_ref.current, selection });
  }, [commit]);

  /** 替换当前 Sidebar 模式。 */
  const set_sidebar_mode = useCallback((sidebar_mode: SidebarMode) => {
    if (state_ref.current.sidebar_mode === sidebar_mode) return;
    commit({ ...state_ref.current, sidebar_mode });
  }, [commit]);

  /** 替换当前 Workspace 上下文。 */
  const set_active_workspace_id = useCallback((active_workspace_id: string) => {
    if (state_ref.current.active_workspace_id === active_workspace_id) return;
    commit({ ...state_ref.current, active_workspace_id });
  }, [commit]);

  /** 写入指定 Plugin 的工作区路由。 */
  const navigate_plugin = useCallback((plugin_id: string, route: PluginJsonObject) => {
    commit({
      ...state_ref.current,
      plugin_routes: { ...state_ref.current.plugin_routes, [plugin_id]: structuredClone(route) },
    });
  }, [commit]);

  /** 通知指定 Plugin 的 Sidebar 与 Mainview 重新读取业务快照。 */
  const invalidate_plugin = useCallback((plugin_id: string) => {
    const current = state_ref.current;
    commit({
      ...current,
      plugin_revisions: {
        ...current.plugin_revisions,
        [plugin_id]: (current.plugin_revisions[plugin_id] ?? 0) + 1,
      },
    });
  }, [commit]);

  return useMemo(() => ({
    store,
    state_ref,
    set_selection,
    set_sidebar_mode,
    set_active_workspace_id,
    navigate_plugin,
    invalidate_plugin,
  }), [invalidate_plugin, navigate_plugin, set_active_workspace_id, set_selection, set_sidebar_mode, state_ref, store]);
}
