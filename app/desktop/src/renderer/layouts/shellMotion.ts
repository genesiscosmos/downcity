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

/**
 * Sidebar 一级图标导航栏（Rail）的宽度。
 *
 * 只有左侧有 rail：右侧 BayBar 收起时完全让出空间，开关是一个与左侧同款的浮动按钮。
 * 左侧最小占地 = Rail + Sidebar 最小宽度。
 */
export const SHELL_SIDEBAR_RAIL_WIDTH = 40;

/** 右侧 BayBar 的宽度范围；与左侧 Sidebar 同为窗口级面板，不随卡片 offset 变化。 */
export const SHELL_BAYBAR_MIN_WIDTH = 360;
export const SHELL_BAYBAR_DEFAULT_WIDTH = 400;

/**
 * 正文卡片的最小宽度。
 *
 * 这是「给正文保留多少」的唯一来源。BayBar 没有自己的最大宽度：
 * 它的上限由「可用区域 − 本值」隐式给出（见 shellResponsive.resolve_baybar_max_width）。
 * 因此拖宽右栏时被限制的是正文的下限，而不是右栏的上限。
 */
export const SHELL_MAIN_VIEW_MIN_WIDTH = 450;

/** 正文区（main）左右内边距之和；卡片最小宽度之外还要为它让出空间。 */
export const SHELL_MAIN_VIEW_GUTTER = SHELL_MAIN_VIEW_OFFSET * 2;

/**
 * 正文需要的最小总占宽（设计 px）：卡片最小宽度 + 两侧留白。
 *
 * 这是右栏宽度上限与窄窗口断点共同的扣除项。
 */
export const SHELL_MAIN_VIEW_MIN_REGION = SHELL_MAIN_VIEW_MIN_WIDTH + SHELL_MAIN_VIEW_GUTTER;

/** 卡片最小宽度的 CSS 值；跟随界面缩放，走 rem 出口。 */
export const SHELL_MAIN_VIEW_MIN_WIDTH_CSS = shell_length_css(shell_scaled_length(SHELL_MAIN_VIEW_MIN_WIDTH));

/**
 * 两侧面板缩放把手的几何。
 *
 * 面板是窗口级的一列，卡片却整体内缩 SHELL_MAIN_VIEW_OFFSET（也就是 main 的 p-1）：
 * 面板边缘与卡片边缘之间必然隔着这段留白，而用户看到的边界是**卡片边缘**。
 * 把手只覆盖面板内侧时，抓取区就比视觉边界向外偏了 4px——手感上表现为
 * 「把手没贴住正文卡片」，其间那段留白还成了拖不动的死区。
 *
 * 所以把手要跨过这段留白：外缘与卡片边缘重合，内侧保留抓握宽度。
 * BLEED 必须恒等于 SHELL_MAIN_VIEW_OFFSET；两者一旦不一致就会重新错开。
 */
export const SHELL_RESIZE_HANDLE_GRIP = 6;
export const SHELL_RESIZE_HANDLE_BLEED = SHELL_MAIN_VIEW_OFFSET;
export const SHELL_RESIZE_HANDLE_WIDTH = SHELL_RESIZE_HANDLE_BLEED + SHELL_RESIZE_HANDLE_GRIP;

/** 把手总宽的 CSS 值。 */
export const SHELL_RESIZE_HANDLE_WIDTH_CSS = shell_length_css(shell_scaled_length(SHELL_RESIZE_HANDLE_WIDTH));

/**
 * 把手向卡片一侧外扩的 CSS 值。
 *
 * 这是「面板边缘 → 卡片边缘」的距离，渲染时按边缘方向取负；见 layouts/PanelResizeHandle。
 */
export const SHELL_RESIZE_HANDLE_BLEED_CSS = shell_length_css(shell_scaled_length(SHELL_RESIZE_HANDLE_BLEED));

/** 两侧顶栏内容共同的垂直中心（绝对坐标）：左侧折叠按钮与 macOS 红绿灯同高。 */
export const SHELL_BAND_CENTER = SHELL_HEADER_DEFAULT_PADDING + SHELL_CONTROL_SIZE / 2;

/**
 * macOS 原生窗口按钮占用的宽度。
 *
 * 它属于窗口 chrome，缩放界面时不能变，因此是 pinned 而不是 scaled。
 */
export const SHELL_WINDOW_CHROME_LEFT = 80;

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

/**
 * 读取当前的界面缩放比例。
 *
 * 界面缩放是通过改写根元素 font-size 实现的，所以 1rem 的实际像素值就是缩放本身。
 * 右栏宽度上限要把「给正文保留的宽度」按缩放换算成实际像素：保留量在 CSS 里是 rem，
 * 而测量得到的可用宽度是实际像素，直接相减会让 120% 下的正文被夹到不足 450 设计像素。
 */
export function read_shell_scale(): number {
  if (typeof document === "undefined") return 1;
  const root_font_size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root_font_size) && root_font_size > 0 ? root_font_size / SHELL_REM_BASE : 1;
}

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
 * 两者基准相差一个 inset，预留量要同时补上这个 inset、按钮自身占宽与间距。
 * 左、右的唯一区别是按钮的起始位置（左侧含 macOS 红绿灯留白，右侧没有）。
 *
 * 不预留的后果是：面板收起后按钮会盖住 Header 右侧的页面操作。
 */
export function shell_collapsed_panel_reserve_length(side: "left" | "right"): ShellLength {
  const control = side === "left" ? shell_control_left_length() : shell_scaled_length(SHELL_HEADER_DEFAULT_PADDING);
  return {
    // 控件左缘含窗口 chrome 的固定留白；卡片边框也是 1px 细线，同样不随缩放变化。
    pinned_px: control.pinned_px - main_view_inset_length.pinned_px,
    scaled_px: control.scaled_px + SHELL_CONTROL_SIZE + SHELL_CONTROL_GAP - main_view_inset_length.scaled_px - SHELL_HEADER_DEFAULT_PADDING,
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
 * 窗口边缘到卡片内容盒的距离。
 *
 * 它不是一整段应用密度：offset 跟随缩放，1px 边框始终是物理像素。
 * 两者混在一起按整体缩放算，预留量就会差 1px ×（缩放 - 1）——
 * 在 120% 下表现为 Header 内容与折叠按钮的间距多出 0.2px 级别的误差。
 */
const main_view_inset_length: ShellLength = { pinned_px: SHELL_MAIN_VIEW_BORDER, scaled_px: SHELL_MAIN_VIEW_OFFSET };

/** 侧栏顶栏高度；与 SidebarFrame 的拖拽带共用同一来源。 */
export const SHELL_HEADER_HEIGHT_LENGTH: ShellLength = shell_scaled_length(SHELL_HEADER_HEIGHT);

/** 侧栏顶栏高度的 CSS 值；SidebarFrame 必须用它，不能写 h-10（两者只在 100% 缩放下偶然相等）。 */
export const SHELL_HEADER_HEIGHT_CSS = shell_length_css(SHELL_HEADER_HEIGHT_LENGTH);

/** 卡内顶栏高度。 */
const main_view_band_height_length: ShellLength = {
  pinned_px: -main_view_inset_length.pinned_px,
  scaled_px: SHELL_HEADER_HEIGHT - main_view_inset_length.scaled_px,
};
const main_view_band_padding_bottom_length: ShellLength = { ...main_view_inset_length };

/** 卡内顶栏高度的 CSS 值；高度与底距必须成对使用，否则内容中心会偏离基准线。 */
export const SHELL_MAIN_VIEW_BAND_HEIGHT_CSS = shell_length_css(main_view_band_height_length);
/** 卡内顶栏底距的 CSS 值。 */
export const SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS = shell_length_css(main_view_band_padding_bottom_length);

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
 * 因此这里不能跟 MainView 卡片对齐——卡片有 offset，
 * 而窗口按钮不受卡片影响（曾经改成按 Header 行居中，导致左按钮位置被抬高）。
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
 * 所以要一并减去 inset 与 Header 自身的内边距。
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
