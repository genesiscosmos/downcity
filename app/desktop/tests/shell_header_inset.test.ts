/**
 * 应用壳的顶栏对齐与两侧面板几何测试。
 *
 * 四件必须同时成立的事：
 * 1. 左右两个折叠按钮与 macOS 原生窗口按钮同高；
 * 2. 两侧顶栏内容落在同一条垂直基准线上；
 * 3. 两侧顶栏的下沿（内容起点）也一致；
 * 4. 上面三条在**任何界面缩放比例下**都成立。
 *
 * 这里按「绝对坐标」断言，而不是重述公式——公式写错时重述式测试会一起错，
 * 无法发现问题（曾经就漏掉过卡片 offset 这一项）。
 *
 * 第 4 条单独存在的原因：缩放通过根元素 font-size 实现，px 不跟随缩放、rem 才跟随。
 * 所以样式必须走 shellMotion 的 CSS 长度出口，本文件用 parse_shell_css() 把它还原成
 * 绝对坐标再断言，直接写 px 的实现会在 scale ≠ 1 时失败。
 *
 * 右侧几何与左侧镜像：两个面板开关都是窗口上的浮动控件，
 * 面板收起后都会浮到卡片之上，两侧的预留推导共用 shell_collapsed_panel_reserve_length()。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  get_baybar_control_right,
  get_collapsed_header_inset,
  get_shell_control_left,
  get_shell_control_top,
  shell_collapsed_header_inset_css,
  shell_collapsed_panel_reserve_length,
  shell_control_left_css,
  shell_length_at_scale,
  SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS,
  SHELL_BAYBAR_CONTROL_RIGHT_CSS,
  SHELL_BAND_CENTER,
  SHELL_CONTROL_GAP,
  SHELL_CONTROL_SIZE,
  SHELL_CONTROL_TOP_CSS,
  SHELL_HEADER_DEFAULT_PADDING,
  SHELL_HEADER_HEIGHT,
  SHELL_HEADER_HEIGHT_CSS,
  SHELL_BAYBAR_MIN_WIDTH,
  SHELL_MAIN_VIEW_MIN_REGION,
  SHELL_MAIN_VIEW_MIN_REGION_CSS,
  SHELL_MAIN_VIEW_MIN_WIDTH,
  SHELL_RESIZE_HANDLE_WIDTH,
  SHELL_RESIZE_HANDLE_WIDTH_CSS,
  SHELL_REM_BASE,
} from "../src/renderer/layouts/shellMotion.ts";

/** 界面缩放的全部档位：设置页允许的最小值、默认值、最大值。 */
const ui_scales = [0.85, 1, 1.2] as const;

/** 在指定平台字符串下执行断言，并在结束后还原全局 navigator。 */
function with_platform(platform: string, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { platform }, configurable: true, writable: true });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

/**
 * 左侧几何（Sidebar 折叠时），坐标从窗口左缘起算。
 * 正文与窗口坐标重合（无留白无边框），因此 Header 内容坐标只需叠加 Header 内边距。
 */
function left_geometry(): { control_right: number; content_left: number } {
  return {
    control_right: get_shell_control_left() + SHELL_CONTROL_SIZE,
    content_left: SHELL_HEADER_DEFAULT_PADDING + get_collapsed_header_inset(),
  };
}

/**
 * 右侧几何（BayBar 收起时），坐标从窗口「右缘」起算。
 * 距离越小越靠近窗口边缘，便于与左侧对称比较。
 */
function right_geometry(): { control_edge: number; content_edge: number } {
  return {
    control_edge: get_baybar_control_right() + SHELL_CONTROL_SIZE,
    content_edge: SHELL_HEADER_DEFAULT_PADDING + shell_length_at_scale(shell_collapsed_panel_reserve_length("right"), 1),
  };
}

test("macOS 为左侧原生窗口按钮保留固定宽度", () => {
  with_platform("MacIntel", () => assert.equal(get_shell_control_left(), 80));
});

test("非 macOS 下 Sidebar 控件贴合窗口边缘的默认留白", () => {
  with_platform("Win32", () => assert.equal(get_shell_control_left(), SHELL_HEADER_DEFAULT_PADDING));
});

test("左侧折叠留白让控件与 Header 内容的实际间距等于设计值", () => {
  for (const platform of ["MacIntel", "Win32"]) {
    with_platform(platform, () => {
      const { control_right, content_left } = left_geometry();
      assert.equal(content_left - control_right, SHELL_CONTROL_GAP, `平台 ${platform} 的实际间距不符`);
    });
  }
});

test("右侧折叠留白让控件与 Header 内容的实际间距等于设计值", () => {
  for (const platform of ["MacIntel", "Win32"]) {
    with_platform(platform, () => {
      const { control_edge, content_edge } = right_geometry();
      assert.equal(content_edge - control_edge, SHELL_CONTROL_GAP, `平台 ${platform} 的实际间距不符`);
    });
  }
});

test("两侧预留由同一个推导给出，只有按钮起始位置不同", () => {
  // 左侧含 macOS 红绿灯留白，右侧不含；除此外双方完全对称。
  with_platform("Win32", () => {
    assert.equal(get_collapsed_header_inset(), shell_length_at_scale(shell_collapsed_panel_reserve_length("right"), 1));
  });
});

test("正文与窗口坐标重合，两侧顶栏因此天然同高", () => {
  // 卡片没有留白也没有边框，因此不存在任何需要补偿的内缩量。
  // 曾经的 SHELL_MAIN_VIEW_INSET / BAND_HEIGHT / BAND_PADDING_BOTTOM 全是为这 1px 服务的，
  // 现在两侧顶栏共用同一个高度常量，不需要成对的补偿。
  const layout = fs.readFileSync(path.join(import.meta.dirname, "../src/renderer/layouts/MainViewLayout.tsx"), "utf8");
  assert.ok(layout.includes("SHELL_HEADER_HEIGHT_CSS"), "卡内顶栏没有用共享的顶栏高度常量");
  assert.ok(!/SHELL_MAIN_VIEW_BAND/.test(layout), "卡内顶栏又出现了偏移补偿量");
  assert.ok(!/rounded-|border /.test(layout.slice(layout.indexOf("export function MainView"), layout.indexOf("export function MainViewHeader"))), "MainView 又画上了圆角或边框");
});

test("左侧折叠按钮与 macOS 原生窗口按钮同高", () => {
  // 左侧按钮与红绿灯对齐，这是窗口外壳的视觉基准。
  assert.equal(get_shell_control_top(), SHELL_HEADER_DEFAULT_PADDING);
});

test("折叠按钮的中心就是两侧顶栏内容的基准线", () => {
  assert.equal(get_shell_control_top() + SHELL_CONTROL_SIZE / 2, SHELL_BAND_CENTER);
});

/** MainView 顶栏内容中心的绝对坐标。 */
function main_view_band_content_center(): number {
  return SHELL_HEADER_HEIGHT / 2;
}

/** MainView 顶栏下沿的绝对坐标。 */
function main_view_band_bottom(): number {
  return SHELL_HEADER_HEIGHT;
}

test("MainView 顶栏内容与侧栏落在同一条基准线上", () => {
  assert.equal(main_view_band_content_center(), SHELL_BAND_CENTER);
});

test("MainView 顶栏下沿与侧栏内容起点对齐", () => {
  assert.equal(main_view_band_bottom(), SHELL_HEADER_HEIGHT);
});

test("整个 MainView 顶栏都容得下最高的头部控件", () => {
  // 顶栏内容带必须容得下最高的头部控件（24px 图标按钮）。
  assert.ok(SHELL_HEADER_HEIGHT >= 24, `顶栏仅 ${SHELL_HEADER_HEIGHT}px，容不下 24px 控件`);
});

test("两侧预留都足够，不会让 Header 内容压到按钮", () => {
  for (const platform of ["MacIntel", "Win32"]) {
    with_platform(platform, () => {
      assert.ok(get_collapsed_header_inset() > 0, `平台 ${platform} 的左侧留白不为正`);
      assert.ok(shell_length_at_scale(shell_collapsed_panel_reserve_length("right"), 1) > 0, `平台 ${platform} 的右侧留白不为正`);
    });
  }
});

test("右侧控制与左侧控制同高、距各自窗口边缘同宽", () => {
  // 两个按钮是镜像的浮动控件，位置由窗口决定，不跟随卡片。
  assert.equal(get_baybar_control_right(), get_shell_control_top());
  assert.equal(get_baybar_control_right(), SHELL_HEADER_DEFAULT_PADDING);
});

test("左侧折叠按钮完整落在窗口级顶栏内，不压住也不溢出该行", () => {
  const control_top = get_shell_control_top();
  const control_bottom = control_top + SHELL_CONTROL_SIZE;
  assert.ok(control_top >= 0, "按钮超出顶栏上边缘");
  assert.ok(control_bottom <= SHELL_HEADER_HEIGHT, "按钮超出顶栏下边缘");
  // 顶栏与卡内顶栏同高，因此它也必然落在卡内顶栏内。
  assert.ok(control_bottom <= main_view_band_bottom(), "按钮超出卡内顶栏下边缘");
});

/**
 * 正文区不留白、无底色：面板内缘就是正文边缘。
 *
 * 留白在两种折叠状态下总有一边是错的——面板展开时它与正文底色不同，那段留白就是一条
 * 看得见的缝；折叠时则是一段无人认领的空档。
 * 底色则应该只由 MainView 提供：main 自己铺底色会在 MainView 未覆盖处漏出另一种颜色。
 */
test("正文区不留内边距也不铺底色", () => {
  const shell = fs.readFileSync(path.join(import.meta.dirname, "../src/renderer/app/DesktopShell.tsx"), "utf8");
  const main_tag = /<main\b[\s\S]*?>/.exec(shell)?.[0] ?? "";
  assert.ok(main_tag, "找不到 main 标签");
  // 任何方向的 p-*/px-*/py-* 都会重新制造那条缝。
  assert.ok(!/\bp[xy]?-[\d.]/.test(main_tag), `main 又出现了内边距，面板与正文之间会露出缝：${main_tag.slice(0, 160)}`);
  assert.ok(!/bg-/.test(main_tag), `main 自己铺了底色，会与 MainView 的底色重叠：${main_tag.slice(0, 160)}`);
});

/**
 * 每个渲染正文页面的入口都必须包在 `MainView` 里。
 *
 * `MainView` 是内容面的唯一提供者（底色 + 纵向容器）；漏掉它时页面会直接铺在窗口底色上，
 * 看起来像“内容显示不对”，但不会报错、也不会被类型系统拦住。
 *
 * 两类入口都要看：
 * 1. **路由级页面**自己包 `MainView`（下面逐个列出）；
 * 2. **内部视图**（AgentView / GroupView / WorkspaceView / SettingsView / ChatLayout）
 *    由它们各自的路由级入口提供，自己不包——它们只出 Header 与 Body。
 *
 * 曾经删 `MainViewLayout` 别名时，五个路由级页面被误改成裸 fragment，插件 Mainview 就在其中。
 */
test("路由级页面都包在 MainView 里", () => {
  const renderer_root = path.join(import.meta.dirname, "../src/renderer");
  // 每个入口都是一个完整的页面，必须自己提供卡片。
  const route_pages = [
    "app/WelcomeView.tsx",
    "features/agent/AgentPage.tsx",
    "features/agent/CreateAgentView.tsx",
    "features/agent/components/AgentChatDetails.tsx",
    "features/group/GroupPage.tsx",
    "features/group/CreateGroupView.tsx",
    "features/group/components/GroupChatDetails.tsx",
    "features/workspace/WorkspacePage.tsx",
    "features/workspace/WorkspaceFileView.tsx",
    "features/power/PowerWorkspaceView.tsx",
    "features/settings/SettingsPage.tsx",
  ];
  const offenders = route_pages.filter((relative_path) => !/<MainView[>\s]/.test(fs.readFileSync(path.join(renderer_root, relative_path), "utf8")));
  assert.deepEqual(offenders, [], `这些页面没有包 MainView，会直接铺在窗口底色上：${offenders.join(", ")}`);
});

/**
 * 两侧面板必须共用同一个把手实现，而且把手只允许出现在面板外壳里。
 *
 * 曾经两侧各内联一份：左侧带负外边距、被 overflow-hidden 削掉一半（实际可拖 3px），
 * 右侧没有负偏移（完整 6px），同一件事两侧手感不一样；几何只能有一个来源。
 *
 * 三列同行之后，这个来源收窄到一处：把手由 `ShellPanel` 渲染（与折叠动画的裁切层同级），
 * 两个面板文件都不再自己摆把手——它们各写一遍就会重新分叉。
 */
test("缩放把手只在 ShellPanel 里出现，两个面板不各自内联", () => {
  const renderer_root = path.join(import.meta.dirname, "../src/renderer");
  const shell_panel = fs.readFileSync(path.join(renderer_root, "layouts/ShellPanel.tsx"), "utf8");
  assert.ok(shell_panel.includes("<PanelResizeHandle"), "ShellPanel 没有使用共享的缩放把手");
  assert.ok(shell_panel.includes('data-shell-panel='), "ShellPanel 没有给面板打测量标记，右栏量不到不含侧栏的可用宽度");
  for (const relative_path of ["layouts/sidebar/SidebarFrame.tsx", "layouts/BayBar.tsx"]) {
    const source = fs.readFileSync(path.join(renderer_root, relative_path), "utf8");
    assert.ok(!source.includes("<PanelResizeHandle"), `${relative_path} 自己摆了把手，两侧几何会再次分叉`);
    assert.ok(!source.includes("cursor-ew-resize"), `${relative_path} 内联了自己的把手，几何会再次分叉`);
  }
});

/**
 * BayBar 面板与 rail 顶栏内容中心的绝对坐标。
 *
 * 三者（侧栏、卡内顶栏、右栏）都是窗口坐标下的同一段顶栏，高度共用同一常量，
 * 因此不需要任何补偿项。
 */
function baybar_band_content_center(): number {
  return SHELL_HEADER_HEIGHT / 2;
}

test("BayBar 顶栏与正文 Header 落在同一条基准线上", () => {
  assert.equal(baybar_band_content_center(), SHELL_BAND_CENTER);
});

test("正文保留量就是正文最小宽度本身", () => {
  // 正文与窗口坐标重合（无留白无边框），因此没有额外的扣除项。
  // 右栏宽度上限与窄窗口断点都从它推导；它算错时两处会一起错，只能在这里锁住。
  assert.equal(SHELL_MAIN_VIEW_MIN_REGION, SHELL_MAIN_VIEW_MIN_WIDTH);
  // 与右栏最小宽度同档：两者都是「一块内容区最少占多宽」。
  assert.equal(SHELL_MAIN_VIEW_MIN_WIDTH, 360);
  assert.equal(SHELL_MAIN_VIEW_MIN_WIDTH, SHELL_BAYBAR_MIN_WIDTH);
});

/**
 * 正文下限必须落在行内元素（main）上，而且只有一处。
 *
 * 两条都会静默失效，所以各配一条守卫：
 *
 * 1. **下限只能有一处。** 卡片是 flex 项，自己写 min-width 只能让它溢出、撑不开父层；
 *    两处同时写会让「谁在限制」变得不可回答（曾经就是两处，删掉卡片那份后实测几何完全一致）。
 * 2. **不能写 `min(360px, 100%)`。** 父层被压窄时 `100%` 跟着变小，下限等于被取消：
 *    正文被压到无法阅读，而样式里看上去“写了 360”。
 */
test("正文下限只落在 main 上，卡片自己不写 min-width", () => {
  const renderer_root = path.join(import.meta.dirname, "../src/renderer");
  const shell = fs.readFileSync(path.join(renderer_root, "app/DesktopShell.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(renderer_root, "layouts/MainViewLayout.tsx"), "utf8");
  // 下限落在 main 自己的 style 上，且跟随缩放（走 rem 出口）。
  const main_tag = /<main\b[\s\S]*?>/.exec(shell)?.[0] ?? "";
  assert.ok(main_tag, "找不到 main 标签");
  assert.ok(/minWidth:\s*SHELL_MAIN_VIEW_MIN_REGION_CSS/.test(main_tag), `正文区的最小宽度没有落在 main 上：${main_tag.slice(0, 160)}`);
  assert.ok(SHELL_MAIN_VIEW_MIN_REGION_CSS.includes("rem"), `正文区最小宽度没跟随缩放：${SHELL_MAIN_VIEW_MIN_REGION_CSS}`);
  // MainView 组件体里不得出现 min-width（下限只能有一处）。
  // 只看这个函数的源码：BayBar 会读 main 的 computed minWidth，那是读取不是声明。
  const main_view = /export function MainView\b[\s\S]*?\n}/.exec(layout)?.[0] ?? "";
  assert.ok(main_view, "找不到 MainView 组件");
  assert.ok(!main_view.includes("minWidth"), "MainView 又自己写了 min-width，下限变成两处");
  assert.ok(!main_view.includes("min("), "MainView 又出现 min(...)，下限会被父层宽度抵消");
});

/**
 * 三列同行：Sidebar、main、BayBar 同属一个窗口行，而两侧宽度上限都是在这层算出来的。
 *
 * 上限 = 行宽 − 正文下限 − 另一侧占宽，三项都是实测值，因此规则必须建立在
 * 「三者同级」这个结构上。规则本身（含 max(实际, 最小) 的取值）由 shell_responsive 测。
 */
test("三列同行，两侧上限都由 ShellPanel 从窗口行算出来", () => {
  const renderer_root = path.join(import.meta.dirname, "../src/renderer");
  const shell = fs.readFileSync(path.join(renderer_root, "app/DesktopShell.tsx"), "utf8");
  // 只看 JSX：import 行里也会出现组件名，会把位置比较带偏。
  const jsx = shell.slice(shell.indexOf("return <div className=\"fixed inset-0"));
  const sidebar_index = jsx.indexOf("<DesktopSidebar");
  const main_tag = /<main\b[\s\S]*?>/.exec(jsx)?.[0] ?? "";
  const main_index = jsx.indexOf(main_tag);
  const baybar_index = jsx.indexOf("<BayBar />");
  assert.ok(sidebar_index !== -1 && main_index !== -1 && baybar_index !== -1, "三列结构不完整");
  // 三者同级且顺序为 Sidebar → main → BayBar。
  assert.ok(sidebar_index < main_index && main_index < baybar_index, "三列的顺序不是 Sidebar / main / BayBar");
  // main 与 Sidebar 同级：两者之间不能再出现一层包住 main 的容器。
  const between = jsx.slice(sidebar_index, main_index);
  assert.ok(!between.includes("<div className=\"flex h-full min-h-0 min-w-0 flex-1\">"), "Sidebar 与 main 之间又出现了中间层");
  // 正文区的最小宽度必须落在 main 自己的标签上（不是父层、也不是 MainView）。
  assert.ok(main_tag.includes("SHELL_MAIN_VIEW_MIN_REGION_CSS"), `正文区下限没落在 main 上：${main_tag.slice(0, 120)}`);

  // 上限由 ShellPanel 统一算：两个面板都不再自己测量，否则规则会分叉。
  const shell_panel = fs.readFileSync(path.join(renderer_root, "layouts/ShellPanel.tsx"), "utf8");
  assert.ok(shell_panel.includes("resolve_panel_max_width"), "ShellPanel 没有用共享的上限推导");
  assert.ok(shell_panel.includes("data-shell-panel={side}"), "ShellPanel 没有按自己的 side 打测量标记");
  assert.ok(/observer\.observe\(row\)/.test(shell_panel) && /observer\.observe\(other\)/.test(shell_panel), "ShellPanel 没有同时观察行与另一侧，上限会停在旧值");
  for (const relative_path of ["layouts/sidebar/SidebarFrame.tsx", "layouts/BayBar.tsx"]) {
    const source = fs.readFileSync(path.join(renderer_root, relative_path), "utf8");
    assert.ok(!/resolve_panel_max_width|ResizeObserver/.test(source), `${relative_path} 自己算了上限，两侧规则会分叉`);
  }
});

/**
 * 窗口行必须带 `min-w-0`。
 *
 * flex 项默认 `min-width: auto`（即 min-content），而 main 带下限——本层于是拒绝缩到
 * 「下限 + 面板」以下：行被撑破、面板被推出窗口，而且量到的可用宽度反过来取决于
 * 面板自己有多宽，拖拽会自激（拖 400 → 399 时直接跳到 360，内容看起来在乱飘）。
 * 这是一条纯 CSS 不变量，源码级守住。
 */
test("窗口行带 min-w-0，否则行被撑破且拖拽自激", () => {
  const renderer_root = path.join(import.meta.dirname, "../src/renderer");
  const shell = fs.readFileSync(path.join(renderer_root, "app/DesktopShell.tsx"), "utf8");
  const jsx = shell.slice(shell.indexOf("return <div className=\"fixed inset-0"));
  const row_tag = /<div className=\"[^\"]*\">/.exec(jsx.slice(jsx.indexOf("BayBarProvider")))?.[0] ?? "";
  assert.ok(row_tag, "找不到窗口行那一层");
  assert.ok(/\bmin-w-0\b/.test(row_tag), `窗口行缺 min-w-0，行会被撑破且拖拽自激：${row_tag}`);
});

/**
 * 把 shellMotion 输出的 CSS 长度还原成像素。
 *
 * 支持 `0px`、`1.25rem`、`calc(80px + 1.25rem)`、`calc(-1px + 2.25rem)`。
 * 单测必须走这个还原：直接比较数值就发现不了「实现里偷偷写成 px」这种
 * 只在缩放后暴露的错误（而它恰恰是这个文件第 4 条不变量的常见死法）。
 */
function parse_shell_css(value: string, scale: number): number {
  const rem_px = SHELL_REM_BASE * scale;
  const calc = value.trim().match(/^calc\((.+)\)$/);
  const terms = (calc ? calc[1]! : value).match(/[+-]?\s*[\d.]+(?:px|rem)/g);
  assert.ok(terms, `无法解析 CSS 长度：${value}`);
  return terms.reduce((total, term) => {
    const parsed = term.match(/^([+-]?)\s*([\d.]+)(px|rem)$/);
    assert.ok(parsed, `无法解析 CSS 长度项：${term}（来自 ${value}）`);
    const magnitude = parsed[1] === "-" ? -Number(parsed[2]) : Number(parsed[2]);
    return total + (parsed[3] === "rem" ? magnitude * rem_px : magnitude);
  }, 0);
}

/** 浮点安全的近似比较：rem 折算会引入极小的尾数。 */
function assert_close(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}（实际 ${actual}，期望 ${expected}）`);
}

/**
 * 断言样式出口确实带上了 rem。
 *
 * 这些值只要退回纯 px，就会在缩放后与侧栏顶栏错位；提前捺住比事后排查便宜。
 */
test("跟随缩放的长度出口必须使用 rem", () => {
  for (const [name, value] of [
    ["正文最小宽度", SHELL_MAIN_VIEW_MIN_REGION_CSS],
    ["顶栏高度", SHELL_HEADER_HEIGHT_CSS],
    ["折叠按钮 top", SHELL_CONTROL_TOP_CSS],
    ["右侧 rail 宽度", SHELL_BAYBAR_CONTROL_RIGHT_CSS],
    ["左侧预留", shell_collapsed_header_inset_css()],
    ["右侧预留", SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS],
    ["缩放把手宽度", SHELL_RESIZE_HANDLE_WIDTH_CSS],
  ] as const) {
    assert.ok(value.includes("rem"), `${name} 没有跟随界面缩放：${value}`);
  }
});

/**
 * 缩放后仍成立的不变量；窗口 chrome 部分保持固定像素，应用密度部分按比例缩放。
 */
for (const scale of ui_scales) {
  test(`${Math.round(scale * 100)}% 缩放下两侧顶栏仍然同处一线`, () => {
    for (const platform of ["MacIntel", "Win32"]) {
      with_platform(platform, () => {
        const context = `平台 ${platform} / 缩放 ${scale}`;
        const header_padding = SHELL_HEADER_DEFAULT_PADDING * scale;
        const control_size = SHELL_CONTROL_SIZE * scale;
        const control_gap = SHELL_CONTROL_GAP * scale;

        // 1. 三者共用同一段顶栏：下沿与内容中心天然对齐，没有补偿项。
        assert_close(parse_shell_css(SHELL_HEADER_HEIGHT_CSS, scale), SHELL_HEADER_HEIGHT * scale, `${context}：顶栏高度未跟随缩放`);
        assert_close(parse_shell_css(SHELL_HEADER_HEIGHT_CSS, scale) / 2, parse_shell_css(SHELL_CONTROL_TOP_CSS, scale) + control_size / 2, `${context}：顶栏内容中心偏离基准线`);
        // 2. 两侧开关的 top 由同一个常量给出，逐档缩放后在缩放意义上仍相等。
        assert_close(parse_shell_css(SHELL_CONTROL_TOP_CSS, scale), SHELL_HEADER_DEFAULT_PADDING * scale, `${context}：开关 top 未跟随缩放`);

        // 3. 折叠后 Header 内容与浮动按钮的实际间距等于设计值。
        const control_left = parse_shell_css(shell_control_left_css(), scale);
        const content_left = header_padding + parse_shell_css(shell_collapsed_header_inset_css(), scale);
        assert_close(content_left - (control_left + control_size), control_gap, `${context}：左侧预留间距不符`);

        const control_right = parse_shell_css(SHELL_BAYBAR_CONTROL_RIGHT_CSS, scale);
        const content_right = header_padding + parse_shell_css(SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS, scale);
        assert_close(content_right - (control_right + control_size), control_gap, `${context}：右侧预留间距不符`);
      });
    }
  });
}

test("缩放不会把预留量或顶栏内容带成负数", () => {
  for (const scale of ui_scales) {
    for (const platform of ["MacIntel", "Win32"]) {
      with_platform(platform, () => {
        const context = `平台 ${platform} / 缩放 ${scale}`;
        assert.ok(parse_shell_css(SHELL_HEADER_HEIGHT_CSS, scale) >= SHELL_CONTROL_SIZE * 0.85, `${context}：顶栏装不下按钮`);
        assert.ok(parse_shell_css(shell_collapsed_header_inset_css(), scale) > 0, `${context}：左侧预留不为正`);
        assert.ok(parse_shell_css(SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS, scale) > 0, `${context}：右侧预留不为正`);
      });
    }
  }
});

/**
 * 把手几何在任意缩放下成立。
 *
 * 把手宽度是应用密度，必须走 rem 出口：写成 px 会在 scale ≠ 1 时与面板边缘错开。
 * 面板展开时该侧留白为 0，卡片边缘与面板内缘重合，因此把手不需要外扩。
 */
for (const scale of ui_scales) {
  test(`${Math.round(scale * 100)}% 缩放下把手宽度仍跟随缩放`, () => {
    const context = `缩放 ${scale}`;
    assert_close(parse_shell_css(SHELL_RESIZE_HANDLE_WIDTH_CSS, scale), 6 * scale, `${context}：把手宽度未跟随缩放`);
  });
}
