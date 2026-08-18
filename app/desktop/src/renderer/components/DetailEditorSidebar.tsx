/** 详情编辑侧栏共享容器，统一关闭、拖拽宽度和底部操作区布局。 */

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { TbX } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { SHELL_PANEL_TRANSITION } from "@/layouts/shellMotion";

/** 详情编辑侧栏属性。 */
interface DetailEditorSidebarProps {
  /** 侧栏标题。 */
  title: string;
  /** 本地宽度设置键。 */
  storage_key: string;
  /** 默认宽度。 */
  default_width: number;
  /** 最小宽度。 */
  min_width?: number;
  /** 最大宽度。 */
  max_width?: number;
  /** 关闭侧栏。 */
  on_close(): void;
  /** 侧栏正文。 */
  children: ReactNode;
  /** 可选底部操作区。 */
  footer?: ReactNode;
}

/** 统一的详情编辑侧栏外壳。 */
export function DetailEditorSidebar({ title, storage_key, default_width, min_width = 360, max_width = 600, on_close, children, footer }: DetailEditorSidebarProps) {
  const [stored_width, set_stored_width] = use_local_storage_width(storage_key, default_width);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({
    stored_width,
    min_width,
    max_width,
    default_width,
    resize_edge: "left",
    on_width_change: (width) => { set_stored_width(width); localStorage.setItem(storage_key, String(width)); },
  });
  return <motion.aside initial={false} animate={{ width: current_width }} transition={{ ...SHELL_PANEL_TRANSITION, duration: is_resizing ? 0 : SHELL_PANEL_TRANSITION.duration }} className="relative flex h-full min-h-0 flex-none overflow-hidden bg-muted">
    <div className="absolute inset-y-0 right-0 flex h-full flex-col border-l border-border/45 bg-muted" style={{ width: current_width }}>
      <div onMouseDown={handle_resize_start} className="absolute -left-[3px] top-0 z-10 h-full w-1.5 cursor-ew-resize" />
      <div className="header-drag-region flex h-10 shrink-0 items-center gap-2 px-2"><Button size="icon" title="关闭" aria-label="关闭" onClick={on_close}><TbX /></Button><h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{title}</h2></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      {footer ? <div className="shrink-0 p-3">{footer}</div> : null}
    </div>
  </motion.aside>;
}

/** 读取侧栏宽度设置。 */
function use_local_storage_width(storage_key: string, default_width: number): [number, (width: number) => void] {
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem(storage_key)) || default_width);
  return [stored_width, set_stored_width];
}
