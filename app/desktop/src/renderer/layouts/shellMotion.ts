/**
 * Duobox 应用壳的面板尺寸与动画常量。
 *
 * ## 单位契约（改这里之前必须先读）
 *
 * 界面缩放（DesktopSettings.ui_scale）是通过改写根元素 font-size 实现的，
 * 因此**只有 rem 会跟随缩放，px 不会**。曾经的写法是「常量给 px、组件用 h-10」，
 * 在 100% 缩放下两者恰好都等于 40px 所以看不出问题，一旦用户把缩放调到 1.2，
 * 侧栏顶栏变 48px、MainView 顶栏仍是 39px，两侧内容就不再同处一线——这正是本模块注释里
 * 反复强调、并且专门写进单测的那条不变量。
 *
 * 所以：下面所有 `SHELL_*` 数值都只是「100% 缩放下的设计 px」，用于计算与断言，
 * **不允许直接写进 style**。落成样式必须走三条出口之一：
 *
 * 1. `shell_length_css(length)`：应用密度（按钮、间距、顶栏高度），跟随缩放；
 * 2. `shell_px(value)`：窗口原生 chrome 与 1px 细线，钉在物理像素上，不跟随缩放；
 * 3. `get_*()` 数字出口：只给逻辑与单测在 100% 缩放下做断言。
 *
 * macOS 红绿灯留白是第 2 类的典型：它由系统窗口决定，缩放界面时不能跟着变，
 * 而它右侧的按钮宽度与间距属于应用密度，必须跟着变。这也正是长度要拆成
 * `pinned_px` 与 `scaled_px` 两部分的原因。
 */

/** 设计基准：100% 缩放下 1rem 等于 16px。 */
export const SHELL_REM_BASE = 16;

export const SHELL_SIDEBAR_MIN_WIDTH = 232;
export const SHELL_SIDEBAR_DEFAULT_WIDTH = 280;
export const SHELL_HEADER_DEFAULT_PADDING = 8;
export const SHELL_CONTROL_SIZE = 24;
export const SHELL_CONTROL_GAP = 8;
/**
 * 侧栏顶栏（窗口顶部拖拽带）的高度；两侧内容都从这条线开始。
 *
 * 顶栏高度两侧共用：正文与窗口坐标重合（无留白、无边框），两侧顶栏天然同高、同基准线。
 * 两侧顶栏因此天然同高、同基准线，不需要任何补偿量。
 */
export const SHELL_HEADER_HEIGHT = 40;

/**
 * Sidebar 一级图标导航栏（Rail）的宽度。
 *
 * 只有左侧有 rail：右侧 BayBar 收起时完全让出空间，开关是一个与左侧同款的浮动按钮。
 * 左侧最小占地 = Rail + Sidebar 最小宽度。
 */
export const SHELL_SIDEBAR_RAIL_WIDTH = 40;

/** 右侧 BayBar 的宽度：最小与默认值；上限同侧栏一样由窗口实时算出来。 */
export const SHELL_BAYBAR_MIN_WIDTH = 360;
export const SHELL_BAYBAR_DEFAULT_WIDTH = 400;

/**
 * 正文的最小宽度（设计 px）。
 *
 * 这是「给正文保留多少」的唯一来源：拖宽右栏时被限制的是正文的下限，不是右栏的上限。
 * 它不在 DOM 里直接用（落点是 SHELL_MAIN_VIEW_MIN_REGION_CSS），
 * 但右栏上限与窄窗口断点都从它推导。
 *
 * 取 360 与右栏最小宽度同档：两者都是「一块内容区最少占多宽」，没有理由不一样。
 * 比这更窄时消息列会开始频繁折行；再宽则白白挤走右栏，而消息列本来就有 840px 上限。
 */
export const SHELL_MAIN_VIEW_MIN_WIDTH = 360;

/**
 * 正文需要的最小占宽（设计 px）。
 *
 * 正文与窗口坐标重合（无留白、无边框），因此它就是正文最小宽度本身。
 * 右栏宽度上限与窄窗口断点共同的扣除项。
 */
export const SHELL_MAIN_VIEW_MIN_REGION = SHELL_MAIN_VIEW_MIN_WIDTH;

/**
 * 正文最小宽度的 CSS 值（DesktopShell 的 main 使用）。
 *
 * 正文下限在 DOM 里只落这一处：同一个常量同时决定「正文占多宽」与「右栏最多能拖多宽」。
 * 必须落在 main 而不是 MainView 上：MainView 是 flex 项，自己的 min-width 只能让它溢出、
 * 撑不开父层。
 */
export const SHELL_MAIN_VIEW_MIN_REGION_CSS = shell_length_css(shell_scaled_length(SHELL_MAIN_VIEW_MIN_REGION));

/**
 * 两侧面板缩放把手的宽度。
 *
 * 正文不留白，面板内缘就是正文边缘，因此把手贴在面板朝正文的那条内缘上即可，
 * 外缘正好落在两者公共边界，不需要任何外扩。
 */
export const SHELL_RESIZE_HANDLE_WIDTH = 6;

/** 把手宽度的 CSS 值。 */
export const SHELL_RESIZE_HANDLE_WIDTH_CSS = shell_length_css(shell_scaled_length(SHELL_RESIZE_HANDLE_WIDTH));

/** 两侧顶栏内容共同的垂直中心（绝对坐标）：左侧折叠按钮与 macOS 红绿灯同高。 */
export const SHELL_BAND_CENTER = SHELL_HEADER_DEFAULT_PADDING + SHELL_CONTROL_SIZE / 2;

/**
 * macOS 原生窗口按钮占用的宽度。
 *
 * 它属于窗口 chrome，缩放界面时不能变，因此是 pinned 而不是 scaled。
 */
export const SHELL_WINDOW_CHROME_LEFT = 80;

export const SHELL_PANEL_TRANSITION = {
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

/**
 * 两侧面板开关相对各自窗口边缘的偏移。
 *
 * 两个按钮是镜像的浮动控件，位置由窗口决定，不跟随卡片内边距，
 * 因此两侧的 top / 边缘留白都取同一个值。
 * 左侧还要额外让出 macOS 红绿灯（属于窗口 chrome，不随缩放变化，见 shell_control_left_length）。
 */
export function get_baybar_control_right(): number {
  return SHELL_HEADER_DEFAULT_PADDING;
}

/** 右侧面板开关的 CSS `right`。 */
export const SHELL_BAYBAR_CONTROL_RIGHT_CSS = shell_length_css(shell_scaled_length(SHELL_HEADER_DEFAULT_PADDING));

/**
 * 返回面板收起时，MainView Header 需要为对应的浮动按钮预留的宽度。
 *
 * 两侧共用同一套推导：按钮以窗口定位，而 Header 内容在卡片内容盒内，
 * 两者基准相差卡片自身的 inset。卡片没有留白也没有边框，inset 为 0，
 * 因此预留量只需补上按钮自身占宽与间距。
 * 左、右的唯一区别是按钮的起始位置（左侧含 macOS 红绿灯留白，右侧没有）。
 *
 * 不预留的后果是：面板收起后按钮会盖住 Header 右侧的页面操作。
 */
export function shell_collapsed_panel_reserve_length(side: "left" | "right"): ShellLength {
  const control = side === "left" ? shell_control_left_length() : shell_scaled_length(SHELL_HEADER_DEFAULT_PADDING);
  return {
    pinned_px: control.pinned_px,
    scaled_px: control.scaled_px + SHELL_CONTROL_SIZE + SHELL_CONTROL_GAP - SHELL_HEADER_DEFAULT_PADDING,
  };
}

/**
 * 一段绝对长度。
 *
 * 拆成两部分是为了区分「跟随界面缩放的应用密度」与「必须钉在物理像素上的窗口 chrome」。
 * 只有需要写进 style 的长度才用这个类型，纯计算仍用上面那些数字常量。
 */
export interface ShellLength {
  /** 不跟随界面缩放的物理像素：窗口原生控件、1px 细线。 */
  pinned_px: number;
  /** 跟随界面缩放的设计像素：按钮、间距、顶栏高度。 */
  scaled_px: number;
}

/** 把设计 px 折算成 rem，去掉浮点噪声。 */
function to_rem(design_px: number): number {
  return Number((design_px / SHELL_REM_BASE).toFixed(5));
}

/**
 * 把长度渲染成 CSS 长度值。
 *
 * 两部分都非零时输出 `calc()`：只有 rem 那部分会跟随界面缩放，
 * px 那部分保持物理像素——这正是窗口 chrome 与窗口边缘对齐所要求的。
 */
export function shell_length_css(length: ShellLength): string {
  const pinned = Number(length.pinned_px.toFixed(3));
  const scaled = to_rem(length.scaled_px);
  if (!pinned && !scaled) return "0px";
  if (!pinned) return `${scaled}rem`;
  if (!scaled) return `${pinned}px`;
  return `calc(${pinned}px ${scaled > 0 ? "+" : "-"} ${Math.abs(scaled)}rem)`;
}

/** 在给定缩放比例下把长度还原成像素；单测用它断言绝对几何。 */
export function shell_length_at_scale(length: ShellLength, scale: number): number {
  return length.pinned_px + length.scaled_px * scale;
}

/** 应用密度长度：整段跟随界面缩放。 */
export function shell_scaled_length(design_px: number): ShellLength {
  return { pinned_px: 0, scaled_px: design_px };
}

/** 固定长度：不跟随界面缩放。 */
export function shell_px(value: number): ShellLength {
  return { pinned_px: value, scaled_px: 0 };
}

/**
 * 顶栏高度；两侧共用同一来源（侧栏拖拽带与卡内顶栏）。
 *
 * 必须走 rem 出口：写 h-10 只在 100% 缩放下恰好等于 40px，缩放后两侧就会错位。
 */
export const SHELL_HEADER_HEIGHT_LENGTH: ShellLength = shell_scaled_length(SHELL_HEADER_HEIGHT);

/** 顶栏高度的 CSS 值；两侧都必须用它，不能写 h-10。 */
export const SHELL_HEADER_HEIGHT_CSS = shell_length_css(SHELL_HEADER_HEIGHT_LENGTH);

/** 左侧折叠按钮距窗口左缘的长度。 */
export function shell_control_left_length(): ShellLength {
  return navigator.platform.toLowerCase().includes("mac")
    ? shell_px(SHELL_WINDOW_CHROME_LEFT)
    : shell_scaled_length(SHELL_HEADER_DEFAULT_PADDING);
}

/**
 * 返回窗口左上角全局 Sidebar 控件的固定横坐标（100% 缩放下的设计 px）。
 */
export function get_shell_control_left(): number {
  return shell_length_at_scale(shell_control_left_length(), 1);
}

/**
 * 左侧折叠按钮的 CSS `left`。
 *
 * 必须是函数：平台判断依赖 navigator，而模块加载期读取会让单测无法按平台注入，
 * 也会把结果冻结在 import 那一刻。
 */
export function shell_control_left_css(): string {
  return shell_length_css(shell_control_left_length());
}

/**
 * 返回两侧折叠按钮的窗口纵向偏移（100% 缩放下的设计 px）。
 *
 * 基准是 macOS 原生窗口按钮（红绿灯）：左侧折叠按钮与它们同高，
 * 这也是窗口外壳的视觉线。右侧按钮向它看齐，两侧保持同一水平线。
 *
 * 因此这里不能跟 MainView 卡片对齐：卡片内容盒虽然与窗口坐标重合，
 * 但折叠按钮是窗口级控件，位置只能由窗口决定。
 */
export function get_shell_control_top(): number {
  return SHELL_HEADER_DEFAULT_PADDING;
}

/** 左侧折叠按钮的 CSS `top`。 */
export const SHELL_CONTROL_TOP_CSS = shell_length_css(shell_scaled_length(SHELL_HEADER_DEFAULT_PADDING));

/**
 * 返回 Sidebar 折叠时，MainView Header 需要额外预留的左侧留白。
 *
 * Sidebar 展开时它占据窗口左侧，浮动的全局 Sidebar 控件落在 Sidebar 自己的拖拽区上，
 * Header 无需避让；折叠后 Sidebar 宽度归零，该控件会浮到卡片之上，
 * 因此 Header 内容必须右移「控件宽度 + 间距」。
 *
 * 注意：控件以窗口左缘定位，而 Header 内容在卡片内容盒内，
 * 两者基准相差卡片自身的 inset（卡片无留白无边框，故为 0），
 * 另要减去 Header 自身的内边距。
 *
 * 推导与右侧共用同一函数：两侧唯一的区别是按钮的起始位置。
 */
export function shell_collapsed_header_inset_length(): ShellLength {
  return shell_collapsed_panel_reserve_length("left");
}

/** 左侧预留留白（100% 缩放下的设计 px）。 */
export function get_collapsed_header_inset(): number {
  return shell_length_at_scale(shell_collapsed_header_inset_length(), 1);
}

/** 左侧预留留白的 CSS 值。 */
export function shell_collapsed_header_inset_css(): string {
  return shell_length_css(shell_collapsed_header_inset_length());
}

/**
 * 右侧预留留白的 CSS 值。
 *
 * 必须放在 main_view_inset_length 之后：它在模块初始化时就会求值，
 * 与上面的左侧常量同理（放到前面会命中 const 的暂时性死区）。
 */
export const SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS = shell_length_css(shell_collapsed_panel_reserve_length("right"));
