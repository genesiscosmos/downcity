/** Desktop 按业务职责组织的页面与应用组件。 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";

import { use_desktop_controller, use_desktop_selector } from "@/app/use_desktop";
import { NavigationSidebar } from "@/layouts/NavigationSidebar";
import { SettingsSidebar } from "@/layouts/SettingsSidebar";

import type { DesktopController } from "@/types/DesktopView";

import { MainViewHeaderProvider } from "@/layouts/MainViewLayout";
import { ShellSidebarControl } from "@/layouts/ShellSidebarControl";
import { resolve_desktop_link } from "@/features/navigation/lib/desktop_link";
import { TurnFileDiffReviewHost } from "@/features/chat/components/messages/TurnFileDiffCard";

import { DesktopMainView } from "@/app/DesktopRouter";
import { DesktopErrorHost } from "@/app/DesktopOverlays";
import { SessionAttachHost } from "@/app/DesktopOverlays";
import { DesktopLanguageSync } from "@/locales/DesktopLanguageSync";
import { use_translation } from "@/locales/i18n";

/** Desktop 根组件。 */
export function DesktopShell() {
  const controller = use_desktop_controller();
  const translate = use_translation();
  const current_selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const stable_controller = useMemo<DesktopController>(() => ({
    stores: controller.stores,
    actions: controller.actions,
  }), [controller.actions, controller.stores]);
  const [create_workspace_dialog_open, set_create_workspace_dialog_open] = useState(false);
  const [sidebar_collapsed, set_sidebar_collapsed] = useState(false);
  const [command_palette_open, set_command_palette_open] = useState(false);
  const open_group_from_sidebar = useCallback((group_id: string) => controller.actions.select_group(group_id), [controller.actions]);
  const open_create_workspace = useCallback(() => set_create_workspace_dialog_open(true), []);

  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "b") {
        event.preventDefault();
        set_sidebar_collapsed((value) => !value);
        return;
      }
      if (modifier && (event.key.toLowerCase() === "l" || event.key.toLowerCase() === "i")) {
        event.preventDefault();
        const input = document.querySelector<HTMLElement>("[data-chat-input='true']");
        input?.focus();
        return;
      }
      if (modifier && event.key === ",") {
        event.preventDefault();
        stable_controller.actions.open_settings("user");
        return;
      }
      const navigation = stable_controller.stores.navigation.get_snapshot();
      if (event.key === "Escape" && navigation.selection?.kind === "settings") {
        event.preventDefault();
        stable_controller.actions.close_settings();
        return;
      }
      if (modifier && event.key.toLowerCase() === "p") {
        event.preventDefault();
        set_command_palette_open(true);
        return;
      }
      if (modifier && event.key.toLowerCase() === "r") {
        event.preventDefault();
        const group_id = navigation.selection && "group_id" in navigation.selection ? navigation.selection.group_id : undefined;
        if (group_id && navigation.active_workspace_id) {
          void stable_controller.actions.create_group_session(group_id, navigation.active_workspace_id);
          return;
        }
        const agent_id = navigation.selection && "agent_id" in navigation.selection ? navigation.selection.agent_id : stable_controller.stores.catalog.get_snapshot().agents[0]?.agent_id;
        if (agent_id && navigation.active_workspace_id) void stable_controller.actions.create_session(navigation.active_workspace_id, agent_id);
      }
    };
    window.addEventListener("keydown", handle_key_down, true);
    return () => window.removeEventListener("keydown", handle_key_down, true);
  }, [stable_controller]);

  useEffect(() => {
    const handle_link_click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      const target = anchor?.getAttribute("href");
      if (!target) return;
      const navigation = stable_controller.stores.navigation.get_snapshot();
      const selection = navigation.selection;
      const context = selection?.kind === "workspace_file"
        ? { workspace_id: selection.workspace_id, relative_path: selection.relative_path }
        : selection && "workspace_id" in selection ? { workspace_id: selection.workspace_id } : { workspace_id: navigation.active_workspace_id || undefined };
      const action = resolve_desktop_link(target, stable_controller.stores.catalog.get_snapshot().workspaces, context);
      if (action.kind === "ignore") return;
      event.preventDefault();
      if (action.kind === "blocked") return;
      if (action.kind === "workspace_file") {
        stable_controller.actions.select_workspace_file(action.workspace_id, action.relative_path);
        return;
      }
      const opening = action.kind === "external_url"
        ? window.downcity.system.open_external_url(action.url)
        : window.downcity.system.open_local_file(action.file_path);
      void opening.catch((reason: unknown) => console.error("打开链接失败", reason));
    };
    document.addEventListener("click", handle_link_click);
    return () => document.removeEventListener("click", handle_link_click);
  }, [stable_controller]);

  return <div className="fixed inset-0 flex h-full min-h-0 w-full overflow-hidden bg-muted">
    <DesktopLanguageSync controller={stable_controller} />
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      {current_selection?.kind === "settings"
        ? <SettingsSidebar controller={stable_controller} collapsed={sidebar_collapsed} />
        : <NavigationSidebar
          controller={stable_controller}
          open_create_agent={controller.actions.open_create_agent}
          open_create_group={controller.actions.open_create_group}
          open_create_workspace={open_create_workspace}
          open_group_config={open_group_from_sidebar}
          collapsed={sidebar_collapsed}
        />}
      <main className="main-view-shell relative flex h-full min-w-0 flex-1 bg-background">
        <TurnFileDiffReviewHost><MainViewHeaderProvider value={{ sidebar_collapsed, baybar_available: false, baybar_open: false }}><div className="flex h-full min-w-0 flex-1 flex-col"><DesktopMainView selection={current_selection} controller={stable_controller} sidebar_collapsed={sidebar_collapsed} /></div></MainViewHeaderProvider></TurnFileDiffReviewHost>
      </main>
    </div>
    <ShellSidebarControl collapsed={sidebar_collapsed} toggle_sidebar={() => set_sidebar_collapsed((value) => !value)} />
    <DesktopErrorHost controller={stable_controller} />
    <CreateWorkspaceDialog open={create_workspace_dialog_open} close_dialog={() => set_create_workspace_dialog_open(false)} create_workspace={controller.actions.create_workspace} />
    <SessionAttachHost controller={stable_controller} />
    {command_palette_open ? <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[18vh]" onMouseDown={() => set_command_palette_open(false)}><div className="w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover p-2 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { set_command_palette_open(false); controller.actions.open_settings("user"); }}>{translate("command_palette.open_settings")} <span className="ml-auto text-xs text-muted-foreground">⌘,</span></button><button type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { set_command_palette_open(false); set_sidebar_collapsed((value) => !value); }}>{translate("command_palette.toggle_sidebar")} <span className="ml-auto text-xs text-muted-foreground">⌘B</span></button></div></div> : null}
  </div>;
}
