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
  SHELL_MAIN_VIEW_BAND_HEIGHT,
  SHELL_MAIN_VIEW_BAND_HEIGHT_CSS,
  SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM,
  SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS,
  SHELL_MAIN_VIEW_BORDER,
  SHELL_MAIN_VIEW_GUTTER,
  SHELL_MAIN_VIEW_INSET,
  SHELL_MAIN_VIEW_MIN_REGION,
  SHELL_MAIN_VIEW_MIN_WIDTH,
  SHELL_MAIN_VIEW_MIN_WIDTH_CSS,
  SHELL_MAIN_VIEW_OFFSET,
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
 * 控件以窗口定位，Header 内容在卡片内容盒内，因此要叠加 inset 与 Header 内边距。
 */
function left_geometry(): { control_right: number; content_left: number } {
  return {
    control_right: get_shell_control_left() + SHELL_CONTROL_SIZE,
    content_left: SHELL_MAIN_VIEW_INSET + SHELL_HEADER_DEFAULT_PADDING + get_collapsed_header_inset(),
  };
}

/**
 * 右侧几何（BayBar 收起时），坐标从窗口「右缘」起算。
 * 距离越小越靠近窗口边缘，便于与左侧对称比较。
 */
function right_geometry(): { control_edge: number; content_edge: number } {
  return {
    control_edge: get_baybar_control_right() + SHELL_CONTROL_SIZE,
    content_edge: SHELL_MAIN_VIEW_INSET + SHELL_HEADER_DEFAULT_PADDING + shell_length_at_scale(shell_collapsed_panel_reserve_length("right"), 1),
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

test("卡片 inset 包含边框，否则卡内一切定位都会偏低 1px", () => {
  assert.equal(SHELL_MAIN_VIEW_INSET, SHELL_MAIN_VIEW_OFFSET + SHELL_MAIN_VIEW_BORDER);
  assert.ok(SHELL_MAIN_VIEW_BORDER > 0, "卡片边框必须计入 inset");
});

test("左侧折叠按钮与 macOS 原生窗口按钮同高", () => {
  // 左侧按钮与红绿灯对齐，这是窗口外壳的视觉基准。
  assert.equal(get_shell_control_top(), SHELL_HEADER_DEFAULT_PADDING);
});

test("折叠按钮的中心就是两侧顶栏内容的基准线", () => {
  assert.equal(get_shell_control_top() + SHELL_CONTROL_SIZE / 2, SHELL_BAND_CENTER);
});

/** MainView 卡片内顶栏内容中心的绝对坐标。 */
function main_view_band_content_center(): number {
  return SHELL_MAIN_VIEW_INSET + (SHELL_MAIN_VIEW_BAND_HEIGHT - SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM) / 2;
}

/** MainView 卡片内顶栏下沿的绝对坐标。 */
function main_view_band_bottom(): number {
  return SHELL_MAIN_VIEW_INSET + SHELL_MAIN_VIEW_BAND_HEIGHT;
}

test("MainView 顶栏内容与侧栏落在同一条基准线上", () => {
  // 卡片整体下移了 offset，顶栏必须相应变矮，内容中心才能回到基准线。
  assert.equal(main_view_band_content_center(), SHELL_BAND_CENTER);
});

test("MainView 顶栏下沿与侧栏内容起点对齐", () => {
  // 侧栏顶栏从窗口顶部开始、高 SHELL_HEADER_HEIGHT，因此其下沿就是该值。
  assert.equal(main_view_band_bottom(), SHELL_HEADER_HEIGHT);
});

test("整个 MainView 顶栏都落在卡片内容盒内，不被裁切", () => {
  // 顶栏内容带必须容得下最高的头部控件（24px 图标按钮）。
  const content_band_height = SHELL_MAIN_VIEW_BAND_HEIGHT - SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM;
  assert.ok(content_band_height >= 24, `内容带仅 ${content_band_height}px，容不下 24px 控件`);
  // 底部内边距必须恰好补齐 inset，否则内容中心会偏离基准线。
  assert.equal(SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM, SHELL_MAIN_VIEW_INSET);
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
  // 两个按钮是镜像的浮动控件，位置由窗口决定，不跟随卡片 inset。
  assert.equal(get_baybar_control_right(), get_shell_control_top());
  assert.equal(get_baybar_control_right(), SHELL_HEADER_DEFAULT_PADDING);
});

test("左侧折叠按钮完整落在窗口级顶栏内，不压住也不溢出该行", () => {
  const control_top = get_shell_control_top();
  const control_bottom = control_top + SHELL_CONTROL_SIZE;
  assert.ok(control_top >= 0, "按钮超出顶栏上边缘");
  assert.ok(control_bottom <= SHELL_HEADER_HEIGHT, "按钮超出顶栏下边缘");
  // Sidebar 折叠时它落在卡片顶栏上，卡内内容带同样要容得下。
  assert.ok(control_bottom <= main_view_band_bottom(), "按钮超出卡内顶栏下边缘");
});

test("卡片留白足够容纳圆角，不会贴住窗口边缘", () => {
  // offset 为 0 时圆角会直接贴边被裁切；保留一个最小值作为约束。
  assert.ok(SHELL_MAIN_VIEW_OFFSET >= 2, "卡片留白过小，圆角会贴边");
});

/**
 * BayBar 面板与 rail 顶栏内容中心的绝对坐标。
 *
 * 两者都是窗口级的一列（与 Sidebar 镜像），顶栏从窗口顶部开始、高 SHELL_HEADER_HEIGHT，
 * 因此没有卡片 inset 那一项。
 */
function baybar_band_content_center(): number {
  return SHELL_HEADER_HEIGHT / 2;
}

test("BayBar 顶栏与正文 Header 落在同一条基准线上", () => {
  // 面板改用卡内 inset 几何（减去 offset、加回边框）会让它比正文 Header 高/低 1px。
  assert.equal(baybar_band_content_center(), SHELL_BAND_CENTER);
});

test("正文保留量由卡片最小宽度与正文区留白共同构成", () => {
  // 右栏宽度上限与窄窗口断点都扣除这个值；它算错时两处会一起错，只能在这里锁住。
  assert.equal(SHELL_MAIN_VIEW_GUTTER, SHELL_MAIN_VIEW_OFFSET * 2);
  assert.equal(SHELL_MAIN_VIEW_MIN_REGION, SHELL_MAIN_VIEW_MIN_WIDTH + SHELL_MAIN_VIEW_GUTTER);
  assert.equal(SHELL_MAIN_VIEW_MIN_WIDTH, 450);
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
    ["MainView 顶栏高度", SHELL_MAIN_VIEW_BAND_HEIGHT_CSS],
    ["MainView 顶栏底距", SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS],
    ["正文卡片最小宽度", SHELL_MAIN_VIEW_MIN_WIDTH_CSS],
    ["侧栏顶栏高度", SHELL_HEADER_HEIGHT_CSS],
    ["折叠按钮 top", SHELL_CONTROL_TOP_CSS],
    ["右侧 rail 宽度", SHELL_BAYBAR_CONTROL_RIGHT_CSS],
    ["左侧预留", shell_collapsed_header_inset_css()],
    ["右侧预留", SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS],
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
        // 卡片 offset 属于应用密度（缩放），1px 细线属于物理像素（不缩放）。
        const inset = SHELL_MAIN_VIEW_OFFSET * scale + SHELL_MAIN_VIEW_BORDER;
        const header_padding = SHELL_HEADER_DEFAULT_PADDING * scale;
        const control_size = SHELL_CONTROL_SIZE * scale;
        const control_gap = SHELL_CONTROL_GAP * scale;
        const band_height = parse_shell_css(SHELL_MAIN_VIEW_BAND_HEIGHT_CSS, scale);
        const band_padding = parse_shell_css(SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS, scale);

        // 1. 卡内顶栏下沿 = 侧栏内容起点。
        assert_close(inset + band_height, parse_shell_css(SHELL_HEADER_HEIGHT_CSS, scale), `${context}：顶栏下沿未对齐`);
        // 2. 卡内顶栏内容中心 = 两侧共同基准线。
        assert_close(inset + (band_height - band_padding) / 2, parse_shell_css(SHELL_CONTROL_TOP_CSS, scale) + control_size / 2, `${context}：内容中心偏离基准线`);

        // 2b. 右栏面板是窗口级一列，与左栏共用同一顶栏高度，内容中心落在同一条基准线上。
        assert_close(parse_shell_css(SHELL_HEADER_HEIGHT_CSS, scale) / 2, parse_shell_css(SHELL_CONTROL_TOP_CSS, scale) + control_size / 2, `${context}：BayBar 顶栏内容中心偏离基准线`);
        // 3. 两侧开关的 top 由同一个常量给出，逐档缩放后在缩放意义上仍相等。
        assert_close(parse_shell_css(SHELL_CONTROL_TOP_CSS, scale), SHELL_HEADER_DEFAULT_PADDING * scale, `${context}：开关 top 未跟随缩放`);

        // 4. 折叠后 Header 内容与浮动按钮的实际间距等于设计值。
        const control_left = parse_shell_css(shell_control_left_css(), scale);
        const content_left = inset + header_padding + parse_shell_css(shell_collapsed_header_inset_css(), scale);
        assert_close(content_left - (control_left + control_size), control_gap, `${context}：左侧预留间距不符`);

        const control_right = parse_shell_css(SHELL_BAYBAR_CONTROL_RIGHT_CSS, scale);
        const content_right = inset + header_padding + parse_shell_css(SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS, scale);
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
        const band_band = parse_shell_css(SHELL_MAIN_VIEW_BAND_HEIGHT_CSS, scale) - parse_shell_css(SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS, scale);
        assert.ok(band_band >= SHELL_CONTROL_SIZE * 0.85, `${context}：卡内顶栏装不下按钮`);
        assert.ok(parse_shell_css(shell_collapsed_header_inset_css(), scale) > 0, `${context}：左侧预留不为正`);
        assert.ok(parse_shell_css(SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS, scale) > 0, `${context}：右侧预留不为正`);
      });
    }
  }
});
