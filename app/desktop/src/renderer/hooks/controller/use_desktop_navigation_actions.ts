/** Desktop 应用导航操作与导航相关副作用。 */

import { useCallback, useEffect, useMemo, type RefObject } from "react";
import type { NavigationTarget, SettingsSection, SidebarMode } from "@/types/DesktopView";
import { desktop_navigation_storage_key, is_restorable_navigation_target } from "@/lib/navigation/desktop_navigation_state";
import { notification_target_from_navigation } from "@/lib/notification/notification_state";
import type { use_catalog_store } from "../store/use_catalog_store";
import type { use_navigation_store } from "../store/use_navigation_store";
import type { use_settings_store } from "../store/use_settings_store";

const active_workspace_storage_key = "downcity.active_workspace_id";

/** 导航操作依赖。 */
interface DesktopNavigationDependencies {
  /** Catalog 领域能力。 */ catalog: ReturnType<typeof use_catalog_store>;
  /** 导航领域能力。 */ navigation: ReturnType<typeof use_navigation_store>;
  /** 设置与错误能力。 */ settings: ReturnType<typeof use_settings_store>;
  /** 进入设置前的导航目标。 */ previous_selection_ref: RefObject<NavigationTarget | null>;
  /** 各一级 Sidebar 最近一次导航目标。 */ selection_by_sidebar_mode_ref: RefObject<Partial<Record<SidebarMode, NavigationTarget>>>;
}

/** 创建稳定导航操作，并闭合持久化与通知可见性生命周期。 */
export function use_desktop_navigation_actions(dependencies: DesktopNavigationDependencies) {
  const { catalog, navigation, settings, previous_selection_ref, selection_by_sidebar_mode_ref } = dependencies;
  useEffect(() => {
    const report_view_state = () => {
      const target = notification_target_from_navigation(navigation.state_ref.current.selection, navigation.state_ref.current.plugin_routes);
      void window.downcity.notification.set_view_state({
        ...(target ? { target } : {}),
        visible: Boolean(target && document.visibilityState === "visible" && document.hasFocus()),
      }).catch(() => undefined);
    };
    report_view_state();
    const unsubscribe_navigation = navigation.store.subscribe(report_view_state);
    document.addEventListener("visibilitychange", report_view_state);
    window.addEventListener("focus", report_view_state);
    window.addEventListener("blur", report_view_state);
    return () => {
      document.removeEventListener("visibilitychange", report_view_state);
      window.removeEventListener("focus", report_view_state);
      window.removeEventListener("blur", report_view_state);
      unsubscribe_navigation();
      void window.downcity.notification.set_view_state({ visible: false }).catch(() => undefined);
    };
  }, [navigation]);
  useEffect(() => {
    const persist_selection = () => {
      const selection = navigation.state_ref.current.selection;
      if (!selection) return;
      const target_mode = get_sidebar_mode_for_target(selection);
      if (target_mode) selection_by_sidebar_mode_ref.current[target_mode] = selection;
      if (is_restorable_navigation_target(selection)) localStorage.setItem(desktop_navigation_storage_key, JSON.stringify(selection));
    };
    persist_selection();
    return navigation.store.subscribe(persist_selection);
  }, [navigation, selection_by_sidebar_mode_ref]);
  const select_plugin = useCallback((plugin_id: string) => { settings.set_error(""); navigation.set_sidebar_mode("plugins"); navigation.set_selection({ kind: "plugin", plugin_id }); }, [navigation, settings]);
  const select_plugins = useCallback(() => { settings.set_error(""); navigation.set_sidebar_mode("plugins"); navigation.set_selection({ kind: "plugins" }); }, [navigation, settings]);
  const select_plugin_workspace = useCallback((plugin_id: string) => {
    const plugin = catalog.state_ref.current.plugins.find((item) => item.plugin_id === plugin_id);
    if (!plugin?.has_sidebar || !plugin.has_mainview) return;
    settings.set_error(""); navigation.set_sidebar_mode(`plugin:${plugin_id}`); navigation.set_selection({ kind: "plugin_workspace", plugin_id });
  }, [catalog, navigation, settings]);
  const navigate_plugin = useCallback((plugin_id: string, route: import("@downcity/city/plugin").PluginJsonObject) => navigation.navigate_plugin(plugin_id, route), [navigation]);
  const invalidate_plugin = useCallback((plugin_id: string) => navigation.invalidate_plugin(plugin_id), [navigation]);
  const set_sidebar_mode = useCallback((mode: SidebarMode) => {
    navigation.set_sidebar_mode(mode);
    const remembered_selection = selection_by_sidebar_mode_ref.current[mode];
    if (remembered_selection) return navigation.set_selection(remembered_selection);
    if (mode === "workspace") {
      const workspace = catalog.state_ref.current.workspaces.find((item) => item.workspace_id === navigation.state_ref.current.active_workspace_id) ?? catalog.state_ref.current.workspaces[0];
      return navigation.set_selection(workspace ? { kind: "workspace", workspace_id: workspace.workspace_id } : null);
    }
    if (mode === "plugins") return navigation.set_selection({ kind: "plugins" });
    const plugin_id = mode.startsWith("plugin:") ? mode.slice("plugin:".length) : undefined;
    const plugin = plugin_id ? catalog.state_ref.current.plugins.find((item) => item.plugin_id === plugin_id) : undefined;
    if (plugin?.has_sidebar && plugin.has_mainview) return navigation.set_selection({ kind: "plugin_workspace", plugin_id: plugin.plugin_id });
    navigation.set_selection(catalog.state_ref.current.agents[0] ? { kind: "agent", agent_id: catalog.state_ref.current.agents[0].agent_id } : null);
  }, [catalog, navigation, selection_by_sidebar_mode_ref]);
  const select_workspace = useCallback((workspace_id: string) => {
    if (!catalog.state_ref.current.workspaces.some((workspace) => workspace.workspace_id === workspace_id)) return;
    settings.set_error(""); navigation.set_sidebar_mode("workspace"); navigation.set_active_workspace_id(workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace_id); navigation.set_selection({ kind: "workspace", workspace_id });
  }, [catalog, navigation, settings]);
  const select_workspace_file = useCallback((workspace_id: string, relative_path: string) => {
    if (!catalog.state_ref.current.workspaces.some((workspace) => workspace.workspace_id === workspace_id)) return;
    settings.set_error(""); navigation.set_sidebar_mode("workspace"); navigation.set_active_workspace_id(workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace_id); navigation.set_selection({ kind: "workspace_file", workspace_id, relative_path });
  }, [catalog, navigation, settings]);
  const select_agent = useCallback((agent_id: string) => { settings.set_error(""); navigation.set_selection({ kind: "agent", agent_id }); }, [navigation, settings]);
  const open_create_agent = useCallback(() => { settings.set_error(""); navigation.set_sidebar_mode("chat"); navigation.set_selection({ kind: "create_agent" }); }, [navigation, settings]);
  const select_group = useCallback((group_id: string) => { settings.set_error(""); navigation.set_selection({ kind: "group", group_id }); }, [navigation, settings]);
  const open_settings = useCallback((section: SettingsSection = "user") => {
    settings.set_error("");
    if (navigation.state_ref.current.selection?.kind !== "settings") previous_selection_ref.current = navigation.state_ref.current.selection;
    navigation.set_selection({ kind: "settings", section });
  }, [navigation, previous_selection_ref, settings]);
  const close_settings = useCallback(() => navigation.set_selection(previous_selection_ref.current ?? (catalog.state_ref.current.agents[0] ? { kind: "agent", agent_id: catalog.state_ref.current.agents[0].agent_id } : null)), [catalog, navigation, previous_selection_ref]);
  return useMemo(() => ({ select_plugin, select_plugins, select_plugin_workspace, navigate_plugin, invalidate_plugin, set_sidebar_mode, select_workspace, select_workspace_file, select_agent, open_create_agent, select_group, open_settings, close_settings }), [close_settings, invalidate_plugin, navigate_plugin, open_create_agent, open_settings, select_agent, select_group, select_plugin, select_plugin_workspace, select_plugins, select_workspace, select_workspace_file, set_sidebar_mode]);
}

/** 返回导航目标所属的一级 Sidebar。 */
function get_sidebar_mode_for_target(target: NavigationTarget): SidebarMode | undefined {
  if (target.kind === "workspace" || target.kind === "workspace_file") return "workspace";
  if (target.kind === "plugin" || target.kind === "plugins") return "plugins";
  if (target.kind === "plugin_workspace") return `plugin:${target.plugin_id}`;
  if (target.kind === "settings") return undefined;
  return "chat";
}
