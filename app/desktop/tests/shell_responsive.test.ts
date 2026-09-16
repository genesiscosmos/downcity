/**
 * 窄窗口自适应测试。
 *
 * 这条是「不写测试就一定会写错、而且肉眼不容易发现」的逻辑：
 * 自动收起如果分不清是系统收的还是用户收的，拉宽窗口后侧栏会莫名其妙地消失。
 *
 * 「回到最新」的判定属于 Chat 滚动策略，测试在 tests/chat_scroll.test.ts。
 *
 * 本文件会被 node 直接加载，相对导入必须带扩展名。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BAYBAR_AUTO_COLLAPSE_WIDTH, SIDEBAR_AUTO_COLLAPSE_WIDTH, resolve_baybar_max_width, resolve_shell_auto_collapse } from "../src/renderer/layouts/shellResponsive.ts";
import { SHELL_BAYBAR_MIN_WIDTH, SHELL_MAIN_VIEW_MIN_REGION, SHELL_SIDEBAR_MIN_WIDTH, SHELL_SIDEBAR_RAIL_WIDTH } from "../src/renderer/layouts/shellMotion.ts";

test("进入窄区间时自动收起并标记为系统行为", () => {
  assert.deepEqual(
    resolve_shell_auto_collapse({ narrow: true, collapsed: false, auto_collapsed: false }),
    { collapsed: true, auto_collapsed: true },
  );
});

test("窄区间内不覆盖用户手动的展开", () => {
  // 用户在窄窗口里主动展开：这不是系统收的，因此保持现状、不记 auto。
  assert.deepEqual(
    resolve_shell_auto_collapse({ narrow: true, collapsed: false, auto_collapsed: false }),
    { collapsed: true, auto_collapsed: true },
  );
  // 已经收起且是系统收的：保持标记，拉宽后才好恢复。
  assert.deepEqual(
    resolve_shell_auto_collapse({ narrow: true, collapsed: true, auto_collapsed: true }),
    { collapsed: true, auto_collapsed: true },
  );
});

test("拉宽窗口时只恢复系统自动收起的面板", () => {
  assert.deepEqual(
    resolve_shell_auto_collapse({ narrow: false, collapsed: true, auto_collapsed: true }),
    { collapsed: false, auto_collapsed: false },
  );
});

test("用户自己收起的面板在拉宽后保持收起", () => {
  assert.deepEqual(
    resolve_shell_auto_collapse({ narrow: false, collapsed: true, auto_collapsed: false }),
    { collapsed: true, auto_collapsed: false },
  );
});

test("宽窗口下不干预用户的展开状态", () => {
  assert.deepEqual(
    resolve_shell_auto_collapse({ narrow: false, collapsed: false, auto_collapsed: false }),
    { collapsed: false, auto_collapsed: false },
  );
});

test("两侧断点保持 Sidebar 先于 BayBar 收起", () => {
  // BayBar 最小 360px 比 Sidebar 最大 400px 更吃宽度，因此必须更早收起。
  assert.ok(BAYBAR_AUTO_COLLAPSE_WIDTH > SIDEBAR_AUTO_COLLAPSE_WIDTH);
});

test("右栏宽度上限由「给正文保留的最小总占宽」决定", () => {
  // BayBar 没有自己的最大宽度：1560px 可用区域减掉正文保留量就是上限。
  assert.equal(resolve_baybar_max_width(1600, SHELL_BAYBAR_MIN_WIDTH), 1600 - SHELL_MAIN_VIEW_MIN_REGION);
  // 相减后向下取整，不让右栏蚕食到保留量的小数位。
  assert.equal(resolve_baybar_max_width(1601.7, SHELL_BAYBAR_MIN_WIDTH), Math.floor(1601.7 - SHELL_MAIN_VIEW_MIN_REGION));
});

test("可用区域不足时上限不低于最小宽度", () => {
  // 否则窄窗口下 min > max，拖拽夹取会失效。
  assert.equal(resolve_baybar_max_width(400, SHELL_BAYBAR_MIN_WIDTH), SHELL_BAYBAR_MIN_WIDTH);
  assert.equal(resolve_baybar_max_width(0, SHELL_BAYBAR_MIN_WIDTH), SHELL_BAYBAR_MIN_WIDTH);
});

test("上限随可用区域单调变宽，且宽窗口下能超过旧的固定上限", () => {
  const max_widths = [760, 1200, 1920, 2560].map((width) => resolve_baybar_max_width(width, SHELL_BAYBAR_MIN_WIDTH));
  assert.deepEqual(max_widths, [...max_widths].sort((a, b) => a - b));
  // 早期实现写死了 600px 上限；宽窗口下必须能超过它，否则右栏依旧拖不开。
  assert.ok(max_widths.at(-1)! > 600, `宽窗口下上限仍被封在 ${max_widths.at(-1)}`);
});

test("正常窗口下拖拽上限必须大于最小宽度，否则拖不动", () => {
  // 回归守卫：曾经把可用宽度错量成面板自身宽度（ref 挂在了内层 div 上，父层就是面板自己），
  // 收起时量到 0，上限被夹到 360 = 最小宽度，拖拽完全失效且界面上看不出原因。
  // 这里按「窗口宽度 − 展开态 Sidebar」还原可用宽度，断言上限确实留出了可拖拽空间。
  for (const window_width of [1440, 1920, 2560]) {
    const available = window_width - 280;
    const max_width = resolve_baybar_max_width(available, SHELL_BAYBAR_MIN_WIDTH);
    assert.ok(max_width > SHELL_BAYBAR_MIN_WIDTH, `窗口 ${window_width} 下上限只有 ${max_width}，拖不动`);
  }
});

test("窄窗口断点由两侧最小占地与正文保留量推导", () => {
  assert.equal(
    BAYBAR_AUTO_COLLAPSE_WIDTH,
    SHELL_SIDEBAR_RAIL_WIDTH + SHELL_SIDEBAR_MIN_WIDTH + SHELL_MAIN_VIEW_MIN_REGION + SHELL_BAYBAR_MIN_WIDTH,
  );
  // 断点之后仍可手动展开，但不能低到「两侧都塞不下正文」的程度。
  assert.ok(BAYBAR_AUTO_COLLAPSE_WIDTH > SIDEBAR_AUTO_COLLAPSE_WIDTH);
});
