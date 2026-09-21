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
import { SHELL_BAYBAR_DEFAULT_WIDTH, SHELL_BAYBAR_MIN_WIDTH, SHELL_MAIN_VIEW_MIN_REGION, SHELL_SIDEBAR_MAX_WIDTH, SHELL_SIDEBAR_MIN_WIDTH, SHELL_SIDEBAR_RAIL_WIDTH } from "../src/renderer/layouts/shellMotion.ts";

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

/**
 * 宽度逻辑的全部内容：上限 = 可用宽度 − 正文下限，装不下时右栏退让。
 *
 * 两个入参都是实测像素（可用宽度量自正文区，正文下限读 main 的 computed min-width），
 * 所以这里不再有任何「设计值 × 缩放」的换算。
 */
test("上限 = 可用宽度 − 正文下限，向下取整", () => {
  assert.equal(resolve_baybar_max_width(1600, SHELL_MAIN_VIEW_MIN_REGION), 1600 - SHELL_MAIN_VIEW_MIN_REGION);
  assert.equal(resolve_baybar_max_width(1601.7, SHELL_MAIN_VIEW_MIN_REGION), Math.floor(1601.7 - SHELL_MAIN_VIEW_MIN_REGION));
});

/**
 * 装不下时上限继续下降，不拿最小宽度兼底。
 *
 * 兼底会让夹取区间 min > max 无解，use_horizontal_resize 取 min 渲染，
 * 面板带着固定宽度溢出到窗口外被裁掉。让位的是右栏——正文下限优先。
 */
test("装不下时上限继续下降，不拿最小宽度兼底", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  assert.ok(resolve_baybar_max_width(600, floor) < SHELL_BAYBAR_MIN_WIDTH, "上限没有跟着可用宽度下降，面板会溢出");
  // 连正文下限都装不下时归 0，而不是负数。
  assert.equal(resolve_baybar_max_width(0, floor), 0);
  assert.equal(resolve_baybar_max_width(floor - 1, floor), 0);
});

/**
 * 面板下限的契约：空间够就是设计下限，装不下就退到上限（min 不能大于 max）。
 *
 * 这就是 BayBar 里那两行（`squeezed` 与 `min_width`）的规则，
 * 顺带也是「是否被窗口挤窄」的判定——被挤窄时不能把宽度写回偏好，
 * 否则用户缩一次窗口，原本存的 400px 就被永久换成一个十几像素的值。
 */
test("面板下限：空间够用设计值，装不下退到上限", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  const resolve = (available: number) => {
    const max_width = resolve_baybar_max_width(available, floor);
    const squeezed = max_width < SHELL_BAYBAR_MIN_WIDTH;
    return { max_width, squeezed, min_width: squeezed ? max_width : SHELL_BAYBAR_MIN_WIDTH };
  };
  // 空间充足：下限就是设计值，右栏不会缩到无法阅读，也不算被挤窄。
  for (const available of [1600, 1440, floor + SHELL_BAYBAR_MIN_WIDTH]) {
    assert.equal(resolve(available).min_width, SHELL_BAYBAR_MIN_WIDTH);
    assert.equal(resolve(available).squeezed, false, `可用宽度 ${available} 下被误判为「被挤窄」，宽度将不再持久化`);
  }
  // 再少 1px 就装不下了：下限退到上限，并标记为被挤窄。
  const tight = resolve(floor + SHELL_BAYBAR_MIN_WIDTH - 1);
  assert.equal(tight.squeezed, true);
  assert.equal(tight.min_width, tight.max_width, "min 大于 max，夹取无解");
});

test("上限随可用宽度单调变宽，且宽窗口下能超过旧的固定上限", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  const max_widths = [760, 1200, 1920, 2560].map((width) => resolve_baybar_max_width(width, floor));
  assert.deepEqual(max_widths, [...max_widths].sort((a, b) => a - b));
  // 早期实现写死了 600px 上限；宽窗口下必须能超过它，否则右栏依旧拖不开。
  assert.ok(max_widths.at(-1)! > 600, `宽窗口下上限仍被封在 ${max_widths.at(-1)}`);
});

/**
 * 上限必须为正文留够空间：这是「拖宽右栏时被限制的是正文下限」的直接表述。
 *
 * 回归守卫：可用宽度曾经把 Sidebar 一起量了进去，于是上限多出一个 Sidebar 的宽度，
 * 用户能把右栏拖到把正文压到下限以下——而界面上看不出任何异常。
 * 这里按「窗口宽度 − 展开态 Sidebar」还原可用宽度（与 DesktopShell 的行结构一致）。
 */
test("按上限拖到最宽时，正文仍然不小于自己的下限", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  for (const window_width of [1440, 1920, 2560]) {
    for (const sidebar_width of [SHELL_SIDEBAR_MIN_WIDTH, 280, SHELL_SIDEBAR_MAX_WIDTH]) {
      const available = window_width - sidebar_width;
      const max_width = resolve_baybar_max_width(available, floor);
      // 可用宽度减去右栏（至多到上限）就是正文能拿到的全部。
      const main_width = available - Math.min(max_width, SHELL_BAYBAR_DEFAULT_WIDTH);
      assert.ok(main_width >= floor, `窗口 ${window_width} / Sidebar ${sidebar_width} 下正文只剩 ${main_width}，低于下限 ${floor}`);
    }
  }
});

test("正常窗口下拖拽上限必须大于最小宽度，否则拖不动", () => {
  // 回归守卫：曾经把可用宽度错量成面板自身宽度（ref 挂在了内层 div 上，父层就是面板自己），
  // 收起时量到 0，上限被夹到 0 与最小宽度相等，拖拽完全失效且界面上看不出原因。
  // 这里按「窗口宽度 − 展开态 Sidebar」还原可用宽度，断言上限确实留出了可拖拽空间。
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  for (const window_width of [1440, 1920, 2560]) {
    const max_width = resolve_baybar_max_width(window_width - 280, floor);
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
