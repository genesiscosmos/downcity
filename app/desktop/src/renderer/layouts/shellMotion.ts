/** Duobox 应用壳的面板尺寸与动画常量。 */

export const SHELL_SIDEBAR_MIN_WIDTH = 232;
export const SHELL_SIDEBAR_MAX_WIDTH = 400;
export const SHELL_SIDEBAR_DEFAULT_WIDTH = 280;
export const SHELL_HEADER_DEFAULT_PADDING = 8;
export const SHELL_CONTROL_SIZE = 24;
export const SHELL_CONTROL_GAP = 8;
/** MainView 卡片相对窗口边缘的留白。 */
export const SHELL_MAIN_VIEW_OFFSET = 4;
/** MainView 卡片的边框宽度；它与 offset 一起把卡片内容推离窗口边缘。 */
export const SHELL_MAIN_VIEW_BORDER = 1;
/**
 * 窗口边缘到 MainView 卡片内容盒的距离。
 *
 * 卡片有 offset，边框又占 1px，卡片内的一切定位都要以这个值为基准。
 * 只减 offset 会留下 1px 偏差——顶栏内容会比侧栏低 1px、标题与折叠按钮的间距会多 1px。
 */
export const SHELL_MAIN_VIEW_INSET = SHELL_MAIN_VIEW_OFFSET + SHELL_MAIN_VIEW_BORDER;
/** 侧栏顶栏（窗口顶部拖拽带）的高度；两侧内容都从这条线开始。 */
export const SHELL_HEADER_HEIGHT = 40;

/** 两侧顶栏内容共同的垂直中心（绝对坐标）：左侧折叠按钮与 macOS 红绿灯同高。 */
export const SHELL_BAND_CENTER = SHELL_HEADER_DEFAULT_PADDING + SHELL_CONTROL_SIZE / 2;

/**
 * MainView 卡片内顶栏的高度。
 *
 * 卡片内容盒从 inset 处开始，而基准线是窗口坐标，因此卡内顶栏要相应变矮，
 * 内容中心才能回到基准线。
 */
export const SHELL_MAIN_VIEW_BAND_HEIGHT = SHELL_HEADER_HEIGHT - SHELL_MAIN_VIEW_INSET;

/**
 * MainView 卡片内顶栏的底部内边距：补齐 inset。
 *
 * 高度减 inset、底距加 inset，两者抵消后顶栏下沿仍在侧栏内容起点（SHELL_HEADER_HEIGHT），
 * 而内容中心被抬回基准线。
 */
export const SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM = SHELL_MAIN_VIEW_INSET;
export const SHELL_PANEL_TRANSITION = {
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

/** 返回窗口左上角全局 Sidebar 控件的固定横坐标。 */
export function get_shell_control_left(): number {
  return navigator.platform.toLowerCase().includes("mac") ? 80 : SHELL_HEADER_DEFAULT_PADDING;
}

/**
 * 返回 Sidebar 折叠时，MainView Header 需要额外预留的左侧留白。
 *
 * Sidebar 展开时它占据窗口左侧，浮动的全局 Sidebar 控件落在 Sidebar 自己的拖拽区上，
 * Header 无需避让；折叠后 Sidebar 宽度归零，该控件会浮到卡片之上，
 * 因此 Header 内容必须右移「控件宽度 + 间距」。
 *
 * 注意：控件以窗口左缘定位，而 Header 内容在卡片内容盒内，
 * 所以要一并减去 inset 与 Header 自身的内边距。
 */
export function get_collapsed_header_inset(): number {
  return get_shell_control_left() + SHELL_CONTROL_SIZE + SHELL_CONTROL_GAP - SHELL_MAIN_VIEW_INSET - SHELL_HEADER_DEFAULT_PADDING;
}

/**
 * 返回右侧折叠按钮相对窗口右缘的偏移。
 *
 * 按钮与左侧按钮同类，都是固定在窗口上的浮动控件，位置由窗口决定，
 * 不应跟随 MainView 卡片的内边距——否则距上边缘与距右边缘会不相等（曾经就是 8 与 13）。
 * 这里与 get_shell_control_top() 同值，保证右侧三边留白一致。
 */
export function get_baybar_control_right(): number {
  return SHELL_HEADER_DEFAULT_PADDING;
}

/**
 * 返回两侧折叠按钮的窗口纵向偏移。
 *
 * 基准是 macOS 原生窗口按钮（红绿灯）：左侧折叠按钮与它们同高，
 * 这也是窗口外壳的视觉线。右侧按钮向它看齐，两侧保持同一水平线。
 *
 * 因此这里不能跟 MainView 卡片对齐——卡片有 offset，
 * 而窗口按钮不受卡片影响（曾经改成按 Header 行居中，导致左按钮位置被抬高）。
 */
export function get_shell_control_top(): number {
  return SHELL_HEADER_DEFAULT_PADDING;
}

/**
 * 返回 BayBar 收起时，MainView Header 需要为按钮预留的宽度。
 *
 * 按钮以窗口定位，而 Header 内容在卡片内容盒内，两者基准不同（相差一个 inset）。
 * 预留量要同时补上这个 inset 与按钮自身占宽，
 * 使内容右边缘与按钮左边缘的实际间距恰好等于 SHELL_CONTROL_GAP。
 */
export function get_baybar_header_reserve(): number {
  return SHELL_CONTROL_SIZE + SHELL_CONTROL_GAP - SHELL_MAIN_VIEW_INSET;
}
