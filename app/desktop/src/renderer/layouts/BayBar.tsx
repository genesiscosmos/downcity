/** Desktop 右侧 BayBar，统一管理右侧面板的宽度、动画与内容切换。 */

import { useCallback, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { TbMessageCircle, TbSettings, TbUsers } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { cn } from "@/lib/utils";
import { SHELL_PANEL_TRANSITION } from "./shellMotion";

/** BayBar 当前状态。 */
export interface BayBarState {
  /** BayBar 是否可见。 */
  open: boolean;
  /** 当前激活的面板类型。 */
  active_tab: "recent" | "agent_config" | "group_config";
}

/** BayBar 属性。 */
interface BayBarProps {
  /** BayBar 当前状态。 */
  state: BayBarState;
  /** 最近 Session 内容。 */
  recent_content: ReactNode;
  /** Agent 配置内容。 */
  agent_config_content?: ReactNode;
  /** Group 配置内容。 */
  group_config_content?: ReactNode;
  /** 切换当前面板。 */
  on_active_tab_change(tab: BayBarState["active_tab"]): void;
}

const BAYBAR_MIN_WIDTH = 360;
const BAYBAR_MAX_WIDTH = 600;
const BAYBAR_DEFAULT_WIDTH = 400;

/** 右侧区域拥有唯一宽度来源，业务内容只负责渲染正文。 */
export function BayBar({ state, recent_content, agent_config_content, group_config_content, on_active_tab_change }: BayBarProps) {
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.baybar_width")) || BAYBAR_DEFAULT_WIDTH);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({
    stored_width,
    min_width: BAYBAR_MIN_WIDTH,
    max_width: BAYBAR_MAX_WIDTH,
    default_width: BAYBAR_DEFAULT_WIDTH,
    resize_edge: "left",
    on_width_change: (width) => {
      set_stored_width(width);
      localStorage.setItem("downcity.baybar_width", String(width));
    },
  });
  const select_tab = useCallback((tab: BayBarState["active_tab"]) => on_active_tab_change(tab), [on_active_tab_change]);
  const active_title = state.active_tab === "recent" ? "最近" : state.active_tab === "agent_config" ? "Agent 配置" : "Group 配置";
  const transition = is_resizing ? { duration: 0 } : SHELL_PANEL_TRANSITION;

  return <motion.aside initial={false} animate={{ width: state.open ? current_width : 0 }} transition={transition} className="relative flex h-full min-h-0 flex-none overflow-hidden bg-muted">
    <div className="relative flex h-full min-h-0 flex-col border-l border-border/45 bg-muted" style={{ width: current_width }}>
      <div onMouseDown={handle_resize_start} className="absolute -left-[3px] top-0 z-10 h-full w-1.5 cursor-ew-resize" />
      <header className="header-drag-region flex h-10 shrink-0 items-center gap-2 pr-10 pl-2">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{active_title}</h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button size="icon" actived={state.active_tab === "recent"} onClick={() => select_tab("recent")} title="最近 Session" aria-label="最近 Session"><TbMessageCircle /></Button>
          {agent_config_content ? <Button size="icon" actived={state.active_tab === "agent_config"} onClick={() => select_tab("agent_config")} title="Agent 配置" aria-label="Agent 配置"><TbSettings /></Button> : null}
          {group_config_content ? <Button size="icon" actived={state.active_tab === "group_config"} onClick={() => select_tab("group_config")} title="Group 配置" aria-label="Group 配置"><TbUsers /></Button> : null}
        </div>
      </header>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div aria-hidden={state.active_tab !== "recent"} className={cn("absolute inset-0", state.active_tab !== "recent" && "invisible pointer-events-none")}>{recent_content}</div>
        {agent_config_content ? <div aria-hidden={state.active_tab !== "agent_config"} className={cn("absolute inset-0", state.active_tab !== "agent_config" && "invisible pointer-events-none")}>{agent_config_content}</div> : null}
        {group_config_content ? <div aria-hidden={state.active_tab !== "group_config"} className={cn("absolute inset-0", state.active_tab !== "group_config" && "invisible pointer-events-none")}>{group_config_content}</div> : null}
      </div>
    </div>
  </motion.aside>;
}
