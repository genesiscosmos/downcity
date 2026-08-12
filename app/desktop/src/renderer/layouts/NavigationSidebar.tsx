/** 直接使用 Duobox Sidebar 结构实现的 Agent + Session 导航。 */

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { TbChevronRight, TbCpu, TbLoader2, TbMessageCircle, TbPlus, TbRefresh } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { cn } from "@/lib/utils";
import type { DesktopViewController } from "@/types/DesktopView";
import { SHELL_PANEL_TRANSITION, SHELL_SIDEBAR_DEFAULT_WIDTH, SHELL_SIDEBAR_MAX_WIDTH, SHELL_SIDEBAR_MIN_WIDTH } from "./shellMotion";

/** 左侧导航面板属性。 */
interface NavigationSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopViewController;
  /** 打开创建 Agent 表单。 */
  open_create_agent(): void;
}

/** Duobox Sidebar 容器，支持相同的宽度和拖拽动画。 */
function SidebarContainer({ children }: { /** Sidebar 的实际业务内容。 */ children: React.ReactNode }) {
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

/** Agent 当前状态对应的导航提示。 */
function get_runtime_text(state: string | undefined): string {
  if (state === "connected") return "已连接";
  if (state === "connecting") return "连接中";
  if (state === "error") return "连接失败";
  return "未连接";
}

/** Agent 与 Session 的 Duobox 导航视图。 */
export function NavigationSidebar({ controller, open_create_agent }: NavigationSidebarProps) {
  return <SidebarContainer>
    <div className="header-drag-region h-9 shrink-0" />
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      <div className="min-w-0 flex-1 truncate px-1 text-xs font-semibold">Agents</div>
      <Button size="icon" title="刷新 Agent" disabled={controller.loading} onClick={() => window.location.reload()}>
        {controller.loading ? <TbLoader2 className="animate-spin" /> : <TbRefresh />}
      </Button>
      <Button size="icon" title="创建 Agent" onClick={open_create_agent}><TbPlus /></Button>
    </div>

    <div data-sidebar-scrollable="true" className="sidebar-body-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {controller.loading ? <div className="py-8 text-center text-xs text-muted-foreground">正在加载…</div> : null}
      {!controller.loading && controller.agents.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">暂无 Agent</div> : null}
      <div className="flex min-w-0 flex-col gap-1">
        {controller.agents.map((agent) => {
          const selected_agent = controller.selection?.agent_id === agent.agent_id;
          const selected_agent_page = selected_agent && controller.selection?.kind === "agent";
          const runtime_state = controller.runtime_by_agent[agent.agent_id];
          const sessions = controller.sessions_by_agent[agent.agent_id] ?? [];
          return <div key={agent.agent_id} className="flex min-w-0 flex-col">
            <div className={cn(
              "group relative flex min-h-8 w-full items-center gap-1 rounded-lg border border-transparent p-0.5 pl-2 text-left transition-all duration-200 ease-out",
              selected_agent_page ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07]",
            )}>
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => controller.select_agent(agent.agent_id)}>
                <TbChevronRight className={cn("size-3 shrink-0 text-muted-foreground/60 transition-transform", selected_agent && "rotate-90")} />
                {runtime_state === "connecting" ? <TbLoader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> : <TbCpu className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate text-xs leading-4 text-foreground">{agent.agent_id}</span>
                <span className={cn("size-1.5 shrink-0 rounded-full", runtime_state === "connected" ? "bg-emerald-500" : runtime_state === "error" ? "bg-destructive" : "bg-muted-foreground/25")} title={get_runtime_text(runtime_state)} />
              </button>
              <Button size="icon" className="opacity-0 group-hover:opacity-100" title="新建 Session" onClick={() => void controller.create_session(agent.agent_id)}><TbPlus /></Button>
            </div>

            {selected_agent ? <div className="ml-5 mt-0.5 flex min-w-0 flex-col gap-0.5 border-l border-border/45 pl-2">
              {runtime_state !== "connected" && sessions.length === 0 ? <Button size="full" className="h-7 text-muted-foreground" disabled={runtime_state === "connecting" || !agent.workspace_id} onClick={() => void controller.connect_agent(agent.agent_id)}>
                {runtime_state === "connecting" ? <TbLoader2 className="animate-spin" /> : <TbCpu />}
                <span className="truncate">{runtime_state === "connecting" ? "正在装配…" : "装配 Agent"}</span>
              </Button> : null}
              {sessions.map((session) => {
                const active = controller.selection?.kind === "session" && controller.selection.session_id === session.session_id;
                return <button
                  key={session.session_id}
                  className={cn(
                    "group relative flex min-h-7 w-full items-center gap-2 rounded-lg border border-transparent px-2 py-0.5 text-left transition-all duration-200 ease-out",
                    active ? "bg-primary/[0.1] hover:bg-primary/[0.12]" : "hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07]",
                  )}
                  onClick={() => void controller.select_session(agent.agent_id, session.session_id)}
                >
                  <TbMessageCircle className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs leading-4 text-foreground">{session.title || "新会话"}</span>
                </button>;
              })}
              {runtime_state === "connected" && sessions.length === 0 ? <div className="px-2 py-3 text-center text-[0.6875rem] text-muted-foreground">暂无 Session</div> : null}
            </div> : null}
          </div>;
        })}
      </div>
    </div>

    <div className="shrink-0 px-2 pb-2">
      <Button size="sidebar" className="rounded-floating-item text-muted-foreground">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        <span className="min-w-0 flex-1 truncate text-left">共享 Downcity CLI Registry</span>
      </Button>
    </div>
  </SidebarContainer>;
}
