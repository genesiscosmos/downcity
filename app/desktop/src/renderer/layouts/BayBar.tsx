/** Desktop 右侧 BayBar，只承载当前用户明确打开的上下文面板。 */

import { useCallback, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { TbCode, TbSettings, TbUsers } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { cn } from "@/lib/utils";
import { SHELL_PANEL_TRANSITION } from "./shellMotion";
import { MainViewHeaderProvider } from "./MainViewLayout";
import { MainViewBayBarControl } from "./ShellSidebarControl";

export interface BayBarState {
  /** BayBar 是否可见。 */
  open: boolean;
  /** 当前打开的具体面板。 */
  active_tab: "agent_config" | "group_config" | "global_env";
}

interface BayBarProps {
  /** 当前面板状态。 */
  state: BayBarState;
  /** Agent 配置内容。 */
  agent_config_content?: ReactNode;
  /** Group 配置内容。 */
  group_config_content?: ReactNode;
  /** Global Env 编辑器内容。 */
  global_env_content?: ReactNode;
  /** 切换具体面板。 */
  on_active_tab_change(tab: BayBarState["active_tab"]): void;
}

const BAYBAR_MIN_WIDTH = 360;
const BAYBAR_MAX_WIDTH = 600;
const BAYBAR_DEFAULT_WIDTH = 400;

/** 单个 MainView 独立拥有的 BayBar 布局属性。 */
interface MainViewBayBarFrameProps {
  /** MainView 稳定标识，用于独立保存展开状态。 */
  view_key: string;
  /** 外层全局 Sidebar 是否折叠。 */
  sidebar_collapsed: boolean;
  /** 当前 MainView 的 BayBar 类型。 */
  active_tab: BayBarState["active_tab"];
  /** 当前 MainView 的 BayBar 内容。 */
  baybar_content: ReactNode;
  /** 渲染 MainView，并提供显式打开 BayBar 的入口。 */
  children(open_baybar: () => void): ReactNode;
}

/** 把 BayBar 状态限制在单个 MainView 生命周期内。 */
export function MainViewBayBarFrame({ view_key, sidebar_collapsed, active_tab, baybar_content, children }: MainViewBayBarFrameProps) {
  const storage_key = `downcity.main_view_baybar_open:${view_key}`;
  const [open, set_open] = useState(() => localStorage.getItem(storage_key) === "true");
  const set_baybar_open = useCallback((next_open: boolean) => {
    set_open(next_open);
    localStorage.setItem(storage_key, String(next_open));
  }, [storage_key]);
  const toggle_baybar = useCallback(() => set_baybar_open(!open), [open, set_baybar_open]);
  const open_baybar = useCallback(() => set_baybar_open(true), [set_baybar_open]);
  return <div className="relative flex h-full min-h-0 min-w-0 flex-1 bg-background">
    <MainViewHeaderProvider value={{ sidebar_collapsed, baybar_available: true, baybar_open: open }}><div className="flex h-full min-w-0 flex-1 flex-col">{children(open_baybar)}</div></MainViewHeaderProvider>
    <BayBar state={{ open, active_tab }} agent_config_content={active_tab === "agent_config" ? baybar_content : undefined} group_config_content={active_tab === "group_config" ? baybar_content : undefined} global_env_content={active_tab === "global_env" ? baybar_content : undefined} on_active_tab_change={() => undefined} />
    <MainViewBayBarControl open={open} toggle_baybar={toggle_baybar} />
  </div>;
}

/** 只渲染当前存在且被打开的具体上下文面板。 */
export function BayBar({ state, agent_config_content, group_config_content, global_env_content, on_active_tab_change }: BayBarProps) {
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.baybar_width")) || BAYBAR_DEFAULT_WIDTH);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({ stored_width, min_width: BAYBAR_MIN_WIDTH, max_width: BAYBAR_MAX_WIDTH, default_width: BAYBAR_DEFAULT_WIDTH, resize_edge: "left", on_width_change: (width) => { set_stored_width(width); localStorage.setItem("downcity.baybar_width", String(width)); } });
  const select_tab = useCallback((tab: BayBarState["active_tab"]) => on_active_tab_change(tab), [on_active_tab_change]);
  const active_content = state.active_tab === "agent_config" ? agent_config_content : state.active_tab === "group_config" ? group_config_content : global_env_content;
  const active_title = active_content ? state.active_tab === "agent_config" ? "Agent 配置" : state.active_tab === "group_config" ? "Group 配置" : "Global Env" : "详情";
  const has_other_tab = Boolean(agent_config_content || group_config_content || global_env_content);
  return <motion.aside initial={false} animate={{ width: state.open ? current_width : 0 }} transition={is_resizing ? { duration: 0 } : SHELL_PANEL_TRANSITION} className="relative flex h-full min-h-0 flex-none overflow-hidden bg-muted"><div className="relative flex h-full min-h-0 flex-col border-l border-border/45 bg-muted" style={{ width: current_width }}><div onMouseDown={handle_resize_start} className="absolute -left-[3px] top-0 z-10 h-full w-1.5 cursor-ew-resize" /><header className="header-drag-region flex h-10 shrink-0 items-center gap-2 pr-10 pl-2"><h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{active_title}</h2><div className="flex shrink-0 items-center gap-0.5">{agent_config_content ? <Button size="icon" actived={state.active_tab === "agent_config"} onClick={() => select_tab("agent_config")} title="Agent 配置" aria-label="Agent 配置"><TbSettings /></Button> : null}{group_config_content ? <Button size="icon" actived={state.active_tab === "group_config"} onClick={() => select_tab("group_config")} title="Group 配置" aria-label="Group 配置"><TbUsers /></Button> : null}{global_env_content ? <Button size="icon" actived={state.active_tab === "global_env"} onClick={() => select_tab("global_env")} title="Global Env" aria-label="Global Env"><TbCode /></Button> : null}</div></header><div className={cn("relative min-h-0 min-w-0 flex-1 overflow-y-auto", !has_other_tab && "border-transparent")}>{active_content ?? <div className="flex h-full items-center justify-center px-6 text-xs text-muted-foreground/60">当前视图暂无可用内容</div>}</div></div></motion.aside>;
}
