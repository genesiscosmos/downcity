/** Agent、Group 等对话页面共用的主视图容器。 */

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { MainViewBody, MainViewHeader, MainViewLayout, use_main_view_header_controls } from "./MainViewLayout";
import { SHELL_PANEL_TRANSITION } from "./shellMotion";

/** 统一 Chat MainView：Session Panel 与包含 Header 的 Chat Surface 水平并列。 */
export function ChatSurfaceLayout({ header_left, header_actions, header_right, sidebar, reserve_shell_control = true, children }: { /** Header 标题。 */ header_left: ReactNode; /** Header 左侧页面操作。 */ header_actions?: ReactNode; /** Header 右侧固定操作组。 */ header_right?: ReactNode; /** Chat Surface 左侧的内部 Sidebar。 */ sidebar?: ReactNode; /** Header 是否为固定 Shell 按钮预留空间。 */ reserve_shell_control?: boolean; /** 对话主体。 */ children: ReactNode }) {
  const controls = use_main_view_header_controls();
  const shell_button_offset = controls?.sidebar_collapsed
    ? navigator.platform.toLowerCase().includes("mac") ? 108 : 36
    : 8;
  return <div className="relative flex h-full min-h-0 min-w-0 flex-1">{header_actions ? <motion.div initial={false} animate={{ left: shell_button_offset }} transition={SHELL_PANEL_TRANSITION} className="absolute top-2 z-[90]">{header_actions}</motion.div> : null}{sidebar}<MainViewLayout><MainViewHeader title={header_left} left_inset={header_actions && reserve_shell_control ? 28 : 0} right_actions={header_right} reserve_shell_control={reserve_shell_control} /><MainViewBody>{children}</MainViewBody></MainViewLayout></div>;
}
