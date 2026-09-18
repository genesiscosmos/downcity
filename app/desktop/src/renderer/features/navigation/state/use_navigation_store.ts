/**
 * 导航领域 store。
 *
 * 承载主视图 selection / 一级 Sidebar 模式 / 当前 Workspace 上下文，
 * 以及功能型 Power 的 Sidebar 与 Mainview 共享路由。只做导航，不承载业务数据。
 */

import { useCallback, useMemo } from "react";
import type { PowerJsonObject } from "@downcity/city/power";
import type { NavigationStoreState, NavigationTarget, SidebarMode } from "@/types/DesktopView";
import { use_store } from "@/lib/store";

const initial_navigation_state: NavigationStoreState = {
  selection: null,
  sidebar_mode: "chat",
  active_workspace_id: "",
  power_routes: {},
  power_revisions: {},
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

  /** 写入指定 Power 的工作区路由。 */
  const navigate_power = useCallback((power_id: string, route: PowerJsonObject) => {
    commit({
      ...state_ref.current,
      power_routes: { ...state_ref.current.power_routes, [power_id]: structuredClone(route) },
    });
  }, [commit]);

  /** 通知指定 Power 的 Sidebar 与 Mainview 重新读取业务快照。 */
  const invalidate_power = useCallback((power_id: string) => {
    const current = state_ref.current;
    commit({
      ...current,
      power_revisions: {
        ...current.power_revisions,
        [power_id]: (current.power_revisions[power_id] ?? 0) + 1,
      },
    });
  }, [commit]);

  return useMemo(() => ({
    store,
    state_ref,
    set_selection,
    set_sidebar_mode,
    set_active_workspace_id,
    navigate_power,
    invalidate_power,
  }), [invalidate_power, navigate_power, set_active_workspace_id, set_selection, set_sidebar_mode, state_ref, store]);
}
