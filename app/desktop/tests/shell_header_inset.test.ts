/**
 * 应用壳的顶栏对齐与两侧面板几何测试。
 *
 * 三件必须同时成立的事：
 * 1. 左右两个折叠按钮与 macOS 原生窗口按钮同高；
 * 2. 两侧顶栏内容落在同一条垂直基准线上；
 * 3. 两侧顶栏的下沿（内容起点）也一致。
 *
 * 这里按「绝对坐标」断言，而不是重述公式——公式写错时重述式测试会一起错，
 * 无法发现问题（曾经就漏掉过卡片 offset 这一项）。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  get_baybar_control_right,
  get_baybar_header_reserve,
  get_collapsed_header_inset,
  get_shell_control_left,
  get_shell_control_top,
  SHELL_BAND_CENTER,
  SHELL_CONTROL_GAP,
  SHELL_CONTROL_SIZE,
  SHELL_HEADER_DEFAULT_PADDING,
  SHELL_HEADER_HEIGHT,
  SHELL_MAIN_VIEW_BAND_HEIGHT,
  SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM,
  SHELL_MAIN_VIEW_BORDER,
  SHELL_MAIN_VIEW_INSET,
  SHELL_MAIN_VIEW_OFFSET,
} from "../src/renderer/layouts/shellMotion.ts";

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
    content_edge: SHELL_MAIN_VIEW_INSET + SHELL_HEADER_DEFAULT_PADDING + get_baybar_header_reserve(),
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

test("卡片 inset 包含边框，否则卡内一切定位都会偏低 1px", () => {
  assert.equal(SHELL_MAIN_VIEW_INSET, SHELL_MAIN_VIEW_OFFSET + SHELL_MAIN_VIEW_BORDER);
  assert.ok(SHELL_MAIN_VIEW_BORDER > 0, "卡片边框必须计入 inset");
});

test("右侧按钮距上边缘与距右边缘相等，三边留白均匀", () => {
  // 按钮是窗口级浮动控件，位置不应跟随卡片 inset。
  for (const platform of ["MacIntel", "Win32"]) {
    with_platform(platform, () => {
      assert.equal(get_baybar_control_right(), get_shell_control_top());
      assert.equal(get_baybar_control_right(), SHELL_HEADER_DEFAULT_PADDING);
    });
  }
});

test("右侧按钮右边缘不会超出卡片外沿", () => {
  // 按钮距窗口右缘 8，卡片边框外沿距窗口右缘 offset；前者必须更大，否则按钮会溢出卡片。
  assert.ok(get_baybar_control_right() >= SHELL_MAIN_VIEW_OFFSET, "按钮超出卡片右边缘");
});

test("两侧折叠按钮与 macOS 原生窗口按钮同高", () => {
  // 左侧按钮历来与红绿灯对齐，这是窗口外壳的视觉基准；
  // 右侧向它看齐，不受 MainView 卡片 offset 影响。
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
      assert.ok(get_baybar_header_reserve() > 0, `平台 ${platform} 的右侧留白不为正`);
    });
  }
});

test("按钮仍落在 MainView 顶栏内，不会压住或溢出该行", () => {
  const control_top = get_shell_control_top();
  const control_bottom = control_top + SHELL_CONTROL_SIZE;
  // 按钮与红绿灯同高，比顶栏内容中心略靠上，但仍须完整落在顶栏内。
  assert.ok(control_top >= SHELL_MAIN_VIEW_INSET, "按钮超出顶栏上边缘");
  assert.ok(control_bottom <= main_view_band_bottom(), "按钮超出顶栏下边缘");
});

test("卡片留白足够容纳圆角，不会贴住窗口边缘", () => {
  // offset 为 0 时圆角会直接贴边被裁切；保留一个最小值作为约束。
  assert.ok(SHELL_MAIN_VIEW_OFFSET >= 2, "卡片留白过小，圆角会贴边");
});
