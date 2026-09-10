/** Desktop 右侧 BayBar，只承载当前用户明确打开的上下文面板。 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { TbX } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { use_translation } from "@/locales/i18n";
import { SHELL_PANEL_TRANSITION } from "./shellMotion";
import { MainViewHeaderProvider } from "./MainViewLayout";

interface BayBarProps {
  /** BayBar 是否可见。 */
  open: boolean;
  /** 当前内容标题。 */
  title: string;
  /** 当前编辑内容。 */
  children: ReactNode;
  /** 关闭 BayBar。 */
  close_baybar(): void;
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
  /** 当前编辑内容的具体标题。 */
  title: string;
  /** 当前 MainView 的 BayBar 内容。 */
  baybar_content: ReactNode;
  /** 渲染 MainView，并提供显式打开 BayBar 的入口。 */
  children(open_baybar: () => void): ReactNode;
}

/** 把 BayBar 状态限制在单个 MainView 生命周期内。 */
export function MainViewBayBarFrame({ view_key, sidebar_collapsed, title, baybar_content, children }: MainViewBayBarFrameProps) {
  const storage_key = `downcity.main_view_baybar_open:${view_key}`;
  const [open, set_open] = useState(() => localStorage.getItem(storage_key) === "true");
  const set_baybar_open = useCallback((next_open: boolean) => {
    set_open(next_open);
    localStorage.setItem(storage_key, String(next_open));
  }, [storage_key]);
  const open_baybar = useCallback(() => set_baybar_open(true), [set_baybar_open]);
  return <div className="relative flex h-full min-h-0 min-w-0 flex-1 bg-background">
    <MainViewHeaderProvider value={{ sidebar_collapsed }}><div className="flex h-full min-w-0 flex-1 flex-col">{children(open_baybar)}</div></MainViewHeaderProvider>
    <BayBar open={open} title={title} close_baybar={() => set_baybar_open(false)}>{baybar_content}</BayBar>
  </div>;
}

/** 渲染只有单一关闭操作的右侧编辑栏。 */
export function BayBar({ open, title, children, close_baybar }: BayBarProps) {
  const translate_navigation = use_translation("navigation");
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.baybar_width")) || BAYBAR_DEFAULT_WIDTH);
  const [content_mounted, set_content_mounted] = useState(open);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({ stored_width, min_width: BAYBAR_MIN_WIDTH, max_width: BAYBAR_MAX_WIDTH, default_width: BAYBAR_DEFAULT_WIDTH, resize_edge: "left", on_width_change: (width) => { set_stored_width(width); localStorage.setItem("downcity.baybar_width", String(width)); } });
  useEffect(() => {
    if (open) set_content_mounted(true);
  }, [open]);
  return <motion.aside initial={false} animate={{ width: open ? current_width : 0 }} transition={is_resizing ? { duration: 0 } : SHELL_PANEL_TRANSITION} onAnimationComplete={() => { if (!open) set_content_mounted(false); }} className="relative flex h-full min-h-0 flex-none overflow-hidden bg-muted"><div className="relative flex h-full min-h-0 flex-col border-l border-border/45 bg-muted" style={{ width: current_width }}><div onMouseDown={handle_resize_start} className="absolute -left-[3px] top-0 z-10 h-full w-1.5 cursor-ew-resize" /><header className="header-drag-region flex h-10 shrink-0 items-center gap-2 px-2"><h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{title}</h2><Button size="icon" onClick={close_baybar} title={translate_navigation("panels.close_right")} aria-label={translate_navigation("panels.close_right")}><TbX /></Button></header><div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">{open || content_mounted ? children : null}</div></div></motion.aside>;
}
