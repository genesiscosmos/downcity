/** Duobox 应用壳的面板尺寸与动画常量。 */

export const SHELL_SIDEBAR_MIN_WIDTH = 232;
export const SHELL_SIDEBAR_MAX_WIDTH = 400;
export const SHELL_SIDEBAR_DEFAULT_WIDTH = 280;
export const SHELL_HEADER_DEFAULT_PADDING = 8;
export const SHELL_CONTROL_SIZE = 24;
export const SHELL_CONTROL_GAP = 8;
export const SHELL_PANEL_TRANSITION = {
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

/** 返回窗口左上角全局 Sidebar 控件的固定横坐标。 */
export function get_shell_control_left(): number {
  return navigator.platform.toLowerCase().includes("mac") ? 80 : SHELL_HEADER_DEFAULT_PADDING;
}

/** 返回 Chat 顶部内容避开 Shell 与 Session 控件后的左侧安全空间。 */
export function get_chat_header_left_inset(sidebar_collapsed: boolean): number {
  const session_control_left = sidebar_collapsed
    ? get_shell_control_left() + SHELL_CONTROL_SIZE + 4
    : SHELL_HEADER_DEFAULT_PADDING;
  return session_control_left + SHELL_CONTROL_SIZE + SHELL_CONTROL_GAP;
}
