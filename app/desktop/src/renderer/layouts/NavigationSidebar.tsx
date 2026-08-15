/** Downcity Desktop 的可切换业务 Sidebar。 */

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { TbSettings, TbUser } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import type { DesktopViewController } from "@/types/DesktopView";
import { SHELL_PANEL_TRANSITION, SHELL_SIDEBAR_DEFAULT_WIDTH, SHELL_SIDEBAR_MAX_WIDTH, SHELL_SIDEBAR_MIN_WIDTH } from "./shellMotion";
import { AgentSidebar } from "./sidebar/AgentSidebar";
import { ChatSidebar } from "./sidebar/ChatSidebar";
import { PluginSidebar } from "./sidebar/PluginSidebar";
import { SidebarViewSwitcher } from "./sidebar/SidebarViewSwitcher";

/** 左侧导航面板属性。 */
interface NavigationSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopViewController;
  /** 打开创建 Agent 表单。 */
  open_create_agent(workspace_id?: string): void;
  /** 打开创建 Workspace 表单。 */
  open_create_workspace(): void;
}

/** Duobox Sidebar 容器，支持相同的宽度和拖拽动画。 */
export function SidebarContainer({ children }: { /** Sidebar 的实际业务内容。 */ children: React.ReactNode }) {
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.sidebar_width")) || SHELL_SIDEBAR_DEFAULT_WIDTH);
  const handle_width_change = useCallback((width: number) => {
    set_stored_width(width);
    localStorage.setItem("downcity.sidebar_width", String(width));
  }, []);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({
    stored_width,
    min_width: SHELL_SIDEBAR_MIN_WIDTH,
    max_width: SHELL_SIDEBAR_MAX_WIDTH,
    default_width: SHELL_SIDEBAR_DEFAULT_WIDTH,
    on_width_change: handle_width_change,
  });

  return <motion.aside
    initial={false}
    animate={{ width: current_width }}
    transition={{ ...SHELL_PANEL_TRANSITION, duration: is_resizing ? 0 : SHELL_PANEL_TRANSITION.duration }}
    className="flex h-full min-h-0 flex-none select-none whitespace-nowrap border-r border-border/35 bg-muted overflow-hidden"
  >
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ width: current_width }}>
      {children}
      <div onMouseDown={handle_resize_start} className="absolute top-0 right-0 z-10 h-full w-1.5 -mr-[3px] cursor-ew-resize" />
    </div>
  </motion.aside>;
}

/** Agent 与 Session 的 Duobox 导航视图。 */
export function NavigationSidebar({ controller, open_create_agent, open_create_workspace }: NavigationSidebarProps) {
  return <SidebarContainer>
    <div className="header-drag-region h-9 shrink-0" />
    <SidebarViewSwitcher active_mode={controller.sidebar_mode} on_change={controller.set_sidebar_mode} />
    {controller.sidebar_mode === "chat" ? <ChatSidebar controller={controller} open_create_agent={open_create_agent} open_create_workspace={open_create_workspace} /> : null}
    {controller.sidebar_mode === "agents" ? <AgentSidebar controller={controller} open_create_agent={open_create_agent} /> : null}
    {controller.sidebar_mode === "plugins" ? <PluginSidebar controller={controller} /> : null}

    <div className="shrink-0 space-y-0.5 px-2 pb-2">
      <Button size="sidebar" className="rounded-floating-item text-muted-foreground" actived={controller.selection?.kind === "settings"} onClick={() => controller.open_settings("user")}>
        {controller.user.avatar_url ? <span className="size-5 shrink-0 overflow-hidden rounded-full"><img src={controller.user.avatar_url} alt="" className="size-full object-cover" /></span> : controller.user.authenticated ? <TbUser /> : <TbSettings />}
        <span className="min-w-0 flex-1 truncate text-left">{controller.user.display_name || controller.user.email || (controller.user.authenticated ? "Downcity 用户" : "设置与登录")}</span>
        <span className={`size-1.5 rounded-full ${controller.user.authenticated ? "bg-emerald-500" : "bg-muted-foreground/25"}`} />
      </Button>
    </div>
  </SidebarContainer>;
}
