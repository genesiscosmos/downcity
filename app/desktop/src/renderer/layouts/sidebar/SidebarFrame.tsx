/** Desktop 左侧 Sidebar 的唯一布局外壳。 */

import { useCallback, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { PanelResizeHandle } from "@/layouts/PanelResizeHandle";
import { SHELL_HEADER_HEIGHT_CSS, SHELL_PANEL_TRANSITION, SHELL_SIDEBAR_DEFAULT_WIDTH, SHELL_SIDEBAR_MAX_WIDTH, SHELL_SIDEBAR_MIN_WIDTH } from "@/layouts/shellMotion";
import { use_translation } from "@/locales/i18n";

/** Sidebar 外壳属性。 */
interface SidebarFrameProps {
  /** Sidebar 是否折叠。 */
  collapsed: boolean;
  /** Rail 与当前 Panel。 */
  children: ReactNode;
}

/**
 * 持有 Sidebar 的宽度、折叠动画、窗口拖拽区和调整尺寸能力。
 * 业务 Panel 不应重复实现这些 Shell 级布局规则。
 */
export function SidebarFrame({ collapsed, children }: SidebarFrameProps) {
  const translate = use_translation("navigation");
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.sidebar_width")) || SHELL_SIDEBAR_DEFAULT_WIDTH);
  const handle_width_change = useCallback((width: number) => {
    set_stored_width(width);
    localStorage.setItem("downcity.sidebar_width", String(width));
  }, []);
  const { current_width, is_resizing, handle_resize_start, resize_handle_props } = use_horizontal_resize({
    stored_width,
    min_width: SHELL_SIDEBAR_MIN_WIDTH,
    max_width: SHELL_SIDEBAR_MAX_WIDTH,
    default_width: SHELL_SIDEBAR_DEFAULT_WIDTH,
    on_width_change: handle_width_change,
  });

  // 列结构：外层不裁切（把手住在这一层），内层负责折叠动画与裁切。
  // 顺序不能反：motion.div 带 overflow-hidden，把手负偏移放进去会被裁掉一半。
  return <div className="relative flex h-full min-h-0 flex-none select-none">
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 0 : current_width }}
      transition={{ ...SHELL_PANEL_TRANSITION, duration: is_resizing ? 0 : SHELL_PANEL_TRANSITION.duration }}
      // Sidebar 与 MainView 卡片之间不画分隔线：两者同处一个背景面，
      // 卡片自己的边框已经提供了足够的层次，再画一条线会显得拥挤。
      //
      // 这一层是折叠动画的裁切层：收起时里面固定宽度的内容必须被裁掉。
      className="flex h-full min-h-0 flex-none select-none overflow-hidden whitespace-nowrap bg-muted"
    >
      <aside className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ width: current_width }}>
        {/* 顶栏高度与 MainView 顶栏共用同一来源；写 h-10 只在 100% 缩放下恰好相等。 */}
        <div className="header-drag-region shrink-0" style={{ height: SHELL_HEADER_HEIGHT_CSS }} aria-hidden="true" />
        <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
      </aside>
    </motion.div>
    {/* 缩放把手：鼠标拖拽与键盘方向键共用同一个元素，因此它必须是可聚焦的真实控件。
        它跨过卡片留白，外缘与卡片边缘重合——留给正文的那点留白不能同时是拖不动的死区。 */}
    {!collapsed ? <PanelResizeHandle side="right" label={translate("sidebar.resize")} resize_handle_props={resize_handle_props} on_resize_start={handle_resize_start} /> : null}
  </div>;
}
