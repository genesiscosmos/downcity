/** Desktop 按业务职责组织的页面与应用组件。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";

import { use_desktop_controller, use_desktop_selector } from "@/app/use_desktop";
import { use_store_selector } from "@/lib/store";
import { DesktopSidebar } from "@/layouts/DesktopSidebar";
import { BayBar, BayBarProvider } from "@/layouts/BayBar";
import { use_baybar_store } from "@/layouts/baybarStore";

import type { DesktopController } from "@/types/DesktopView";

import { ShellLayoutProvider } from "@/layouts/MainViewLayout";
import { ShellSidebarControl } from "@/layouts/ShellSidebarControl";
import { SIDEBAR_AUTO_COLLAPSE_WIDTH, resolve_shell_auto_collapse } from "@/layouts/shellResponsive";
import { use_media_query } from "@/hooks/use_media_query";
import { resolve_desktop_link } from "@/features/navigation/lib/desktop_link";
import { resolve_sidebar_shortcut_mode } from "@/features/navigation/lib/sidebar_shortcut";

import { DesktopMainView } from "@/app/DesktopRouter";
import { DesktopErrorHost } from "@/app/DesktopOverlays";
import { SessionAttachHost } from "@/app/DesktopOverlays";
import { DesktopLanguageSync } from "@/locales/DesktopLanguageSync";
import { DesktopAppearanceSync } from "@/features/settings/DesktopAppearanceSync";
import { CommandPalette, CommandProviders, type ShellCommandEnvironment } from "@/features/command-palette";

/**
 * 是否存在比命令面板优先级更高的模态浮层。
 *
 * 依赖 `components/ui/dialog.tsx` 在 Popup 上写的 `data-desktop-modal` 标记。
 */
function has_open_modal(): boolean {
  return document.querySelector("[data-desktop-modal='true']") !== null;
}

/** Desktop 根组件。 */
export function DesktopShell() {
  const controller = use_desktop_controller();
  const current_selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const stable_controller = useMemo<DesktopController>(() => ({
    stores: controller.stores,
    actions: controller.actions,
  }), [controller.actions, controller.stores]);
  const [create_workspace_dialog_open, set_create_workspace_dialog_open] = useState(false);
  const [sidebar_collapsed, set_sidebar_collapsed] = useState(false);
  // 右侧 BayBar 与 Sidebar、MainView 并列：tab 由内容组件自己注册，
  // Shell 不需要知道面板里显示什么。
  const baybar = use_baybar_store();
  // 窄窗口自动收起：窗口最小宽度只有 760px，两侧面板都展开会把正文挤到不足 130px。
  const narrow_window = use_media_query(`(max-width: ${SIDEBAR_AUTO_COLLAPSE_WIDTH}px)`);
  const auto_collapsed_ref = useRef(false);
  useEffect(() => {
    const next = resolve_shell_auto_collapse({
      narrow: narrow_window,
      collapsed: sidebar_collapsed,
      auto_collapsed: auto_collapsed_ref.current,
    });
    auto_collapsed_ref.current = next.auto_collapsed;
    set_sidebar_collapsed(next.collapsed);
    // sidebar_collapsed 有意不进依赖：本效果只响应「窗口跨越断点」，
    // 否则用户手动展开会被立即覆盖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow_window]);
  const [command_palette_open, set_command_palette_open] = useState(false);
  const open_group_from_sidebar = useCallback((group_id: string) => controller.actions.select_group(group_id), [controller.actions]);
  const open_create_workspace = useCallback(() => set_create_workspace_dialog_open(true), []);
  const toggle_sidebar = useCallback(() => set_sidebar_collapsed((value) => !value), []);
  // BayBar 与 Sidebar 同构：只订阅一位布尔值，不把面板 store 透给 MainView。
  // 判断依据只能是 open——空白标签页也是展开状态。
  const baybar_collapsed = use_store_selector(baybar.store, (state) => !state.open);
  const toggle_baybar = baybar.toggle;
  const shell_layout = useMemo(() => ({ sidebar_collapsed, baybar_collapsed }), [baybar_collapsed, sidebar_collapsed]);

  /** 在当前导航目标上新建对话；⌘R 与命令面板的「新建对话」共用同一实现。 */
  const create_conversation_in_context = useCallback(() => {
    const navigation = stable_controller.stores.navigation.get_snapshot();
    const group_id = navigation.selection && "group_id" in navigation.selection ? navigation.selection.group_id : undefined;
    if (group_id && navigation.active_workspace_id) {
      void stable_controller.actions.create_group_session(group_id, navigation.active_workspace_id);
      return;
    }
    const agent_id = navigation.selection && "agent_id" in navigation.selection
      ? navigation.selection.agent_id
      : stable_controller.stores.catalog.get_snapshot().agents[0]?.agent_id;
    if (agent_id && navigation.active_workspace_id) void stable_controller.actions.create_session(navigation.active_workspace_id, agent_id);
  }, [stable_controller]);

  /** Shell 自己拥有的能力；不属于任何 domain store，因此不进 controller。 */
  const shell_environment = useMemo<ShellCommandEnvironment>(() => ({
    sidebar_collapsed,
    toggle_sidebar,
    baybar_collapsed,
    toggle_baybar,
    open_create_workspace,
    create_conversation_in_context,
  }), [baybar_collapsed, create_conversation_in_context, open_create_workspace, sidebar_collapsed, toggle_baybar, toggle_sidebar]);

  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      // 命令面板打开期间它就是唯一的键盘上下文，只保留 ⌘/Ctrl+P 再次按下将其关闭。
      if (command_palette_open) {
        if (modifier && !event.altKey && !event.shiftKey && key === "p") {
          event.preventDefault();
          set_command_palette_open(false);
        }
        return;
      }

      // 修正原实现：unmodified 判断缺了 Shift/Alt，⌘⇧P 与 ⌘⌥P 也会被当成打开面板。
      if (modifier && !event.altKey && !event.shiftKey && key === "p") {
        event.preventDefault();
        if (!has_open_modal()) set_command_palette_open(true);
        return;
      }

      if (modifier && key === "b") {
        event.preventDefault();
        toggle_sidebar();
        return;
      }
      // ⌘/Ctrl+L 切右侧面板。它此前是「聚焦 Chat 输入框」的键位之一；
      // 该操作保留同义键 ⌘/Ctrl+I，因此没丢失键盘入口（设置页已同步说明）。
      if (modifier && key === "l") {
        event.preventDefault();
        toggle_baybar();
        return;
      }
      if (modifier && key === "i") {
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
      if (modifier && !event.altKey && !event.shiftKey) {
        const sidebar_mode = resolve_sidebar_shortcut_mode(event.key, stable_controller.stores.catalog.get_snapshot().powers);
        if (sidebar_mode) {
          event.preventDefault();
          stable_controller.actions.set_sidebar_mode(sidebar_mode);
          return;
        }
      }
      const navigation = stable_controller.stores.navigation.get_snapshot();
      if (event.key === "Escape" && navigation.selection?.kind === "settings") {
        event.preventDefault();
        stable_controller.actions.close_settings();
        return;
      }
      if (modifier && key === "r") {
        event.preventDefault();
        create_conversation_in_context();
      }
    };
    window.addEventListener("keydown", handle_key_down, true);
    return () => window.removeEventListener("keydown", handle_key_down, true);
  }, [command_palette_open, create_conversation_in_context, stable_controller, toggle_baybar, toggle_sidebar]);

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
        stable_controller.actions.select_workspace_file(action.workspace_id, action.relative_path, action.line);
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
    <DesktopAppearanceSync controller={stable_controller} />
    <DesktopLanguageSync controller={stable_controller} />
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      <DesktopSidebar
        controller={stable_controller}
        open_create_agent={controller.actions.open_create_agent}
        open_create_group={controller.actions.open_create_group}
        open_create_workspace={open_create_workspace}
        open_group_config={open_group_from_sidebar}
        collapsed={sidebar_collapsed}
      />
      {/* 右侧 BayBar 与左侧 Sidebar 平级，同属窗口级面板。
          Provider 同时包住正文与面板：正文里的入口靠同一份 context 打开面板。 */}
      <BayBarProvider value={baybar}>
        <main className="relative flex h-full min-w-0 flex-1 bg-muted p-1">
          <ShellLayoutProvider value={shell_layout}>
            <DesktopMainView selection={current_selection} controller={stable_controller} sidebar_collapsed={sidebar_collapsed} />
          </ShellLayoutProvider>
        </main>
        <BayBar />
      </BayBarProvider>
    </div>
    <ShellSidebarControl collapsed={sidebar_collapsed} toggle_sidebar={toggle_sidebar} />
    <DesktopErrorHost controller={stable_controller} />
    <CreateWorkspaceDialog open={create_workspace_dialog_open} close_dialog={() => set_create_workspace_dialog_open(false)} create_workspace={controller.actions.create_workspace} />
    <SessionAttachHost controller={stable_controller} />
    {/* 命令提供者常驻挂载，使命令在面板未打开时也已注册；面板本身只负责展示与交互。 */}
    <CommandProviders controller={stable_controller} shell={shell_environment} />
    <CommandPalette open={command_palette_open} on_close={() => set_command_palette_open(false)} controller={stable_controller} />
  </div>;
}
