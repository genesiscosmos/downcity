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
import { BAYBAR_AUTO_COLLAPSE_WIDTH, SIDEBAR_AUTO_COLLAPSE_WIDTH, resolve_panel_max_width, resolve_shell_auto_collapse } from "../src/renderer/layouts/shellResponsive.ts";
import { SHELL_BAYBAR_DEFAULT_WIDTH, SHELL_BAYBAR_MIN_WIDTH, SHELL_MAIN_VIEW_MIN_REGION, SHELL_SIDEBAR_DEFAULT_WIDTH, SHELL_SIDEBAR_MIN_WIDTH, SHELL_SIDEBAR_RAIL_WIDTH } from "../src/renderer/layouts/shellMotion.ts";

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
 * 宽度逻辑的全部内容：上限 = 行宽 − 正文下限 − 另一侧占宽，装不下时本侧退让。
 *
 * 入参都是实测像素（行宽量自窗口行，正文下限读 main 的 computed min-width），
 * 所以这里不再有任何「设计值 × 缩放」的换算。
 */
test("上限 = 行宽 − 正文下限 − 另一侧占宽，向下取整", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  assert.equal(
    resolve_panel_max_width({ row_width: 1600, content_floor: floor, other_width: 280, other_min_width: SHELL_SIDEBAR_MIN_WIDTH }),
    1600 - floor - 280,
  );
  assert.equal(
    resolve_panel_max_width({ row_width: 1601.7, content_floor: floor, other_width: 280, other_min_width: SHELL_SIDEBAR_MIN_WIDTH }),
    Math.floor(1601.7 - floor - 280),
  );
});

/**
 * 另一侧占宽取 max(实际宽, 最小宽)。
 *
 * 两个值各管一件事，这条守住它们不会被写成别的组合：
 *
 * | 取哪个 | 管什么 |
 * | --- | --- |
 * | 实际宽 | 不溢出：另一侧已拖宽时，本侧上限必须跟着变小 |
 * | 最小宽 | 不被压成 0：另一侧当前折叠（实际宽 0）时，仍要为它展开预留位置 |
 *
 * 取大而不是相加：两者描述的是同一个下界，相加会双重扣除。
 */
test("另一侧占宽取 max(实际宽, 最小宽)", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  const resolve = (other_width: number) => resolve_panel_max_width({
    row_width: 1600,
    content_floor: floor,
    other_width,
    other_min_width: SHELL_SIDEBAR_MIN_WIDTH,
  });
  // 另一侧折叠（实测 0）：仍按它的最小宽度预留，不能把位置让给本侧。
  assert.equal(resolve(0), 1600 - floor - SHELL_SIDEBAR_MIN_WIDTH);
  // 另一侧比最小还窄（不可能出现，但规则必须单调）：仍按最小预留。
  assert.equal(resolve(SHELL_SIDEBAR_MIN_WIDTH - 40), 1600 - floor - SHELL_SIDEBAR_MIN_WIDTH);
  // 另一侧已拖宽：按它的实际宽度扣，本侧上限跟着变小。
  assert.equal(resolve(400), 1600 - floor - 400);
  // 不是相加：扣的就是一个「另一侧占多宽」，不是实际宽 + 最小宽。
  assert.notEqual(resolve(400), 1600 - floor - 400 - SHELL_SIDEBAR_MIN_WIDTH);
});

/**
 * 装不下时上限继续下降，不拿最小宽度兼底。
 *
 * 兼底会让夹取区间 min > max 无解，use_horizontal_resize 取 min 渲染，
 * 面板带着固定宽度溢出到窗口外被裁掉。让位的是本侧——正文下限优先。
 */
test("装不下时上限继续下降，不拿最小宽度兼底", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  const resolve = (row_width: number) => resolve_panel_max_width({
    row_width,
    content_floor: floor,
    other_width: 280,
    other_min_width: SHELL_SIDEBAR_MIN_WIDTH,
  });
  assert.ok(resolve(600) < SHELL_BAYBAR_MIN_WIDTH, "上限没有跟着行宽下降，面板会溢出");
  // 连正文下限都装不下时归 0，而不是负数。
  assert.equal(resolve(0), 0);
  assert.equal(resolve(floor - 1), 0);
});

/**
 * 两侧对称：同一条规则、同一组入参下互换两侧只换「另一侧占宽」。
 *
 * 这是本轮改动的核心：侧栏与右栏面对同一个约束（拖宽任意一侧都在从正文那里拿宽度），
 * 因此不应各有一套上限。侧栏不再有固定上限，能拖到窗口允许的宽度。
 */
test("两侧上限对称，且侧栏不再受固定上限限制", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  const row_width = 1440;
  const sidebar_max = resolve_panel_max_width({
    row_width,
    content_floor: floor,
    other_width: SHELL_BAYBAR_DEFAULT_WIDTH,
    other_min_width: SHELL_BAYBAR_MIN_WIDTH,
  });
  const baybar_max = resolve_panel_max_width({
    row_width,
    content_floor: floor,
    other_width: SHELL_SIDEBAR_DEFAULT_WIDTH,
    other_min_width: SHELL_SIDEBAR_MIN_WIDTH,
  });
  // 侧栏能拖到远超旧的 400 固定上限。
  assert.ok(sidebar_max > 400, `侧栏上限只有 ${sidebar_max}，仍被旧上限卡住`);
  // 拖到极限时，正文恰好停在下限、另一侧不小于自己的最小宽度。
  assert.equal(row_width - sidebar_max - SHELL_BAYBAR_DEFAULT_WIDTH, floor);
  assert.equal(row_width - baybar_max - SHELL_SIDEBAR_DEFAULT_WIDTH, floor);
  assert.ok(sidebar_max >= SHELL_SIDEBAR_MIN_WIDTH && baybar_max >= SHELL_BAYBAR_MIN_WIDTH, "上限低于自己的最小宽度，拖不动");
});

/**
 * 面板下限的契约：空间够就是设计下限，装不下就退到上限（min 不能大于 max）。
 *
 * 这就是 ShellPanel 里那两行（`squeezed` 与 `min_width`）的规则，
 * 顺带也是「是否被窗口挤窄」的判定——被挤窄时不能把宽度写回偏好，
 * 否则用户缩一次窗口，原本存的宽度就被永久换成一个十几像素的值。
 */
test("面板下限：空间够用设计值，装不下退到上限", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  const resolve = (row_width: number) => {
    const max_width = resolve_panel_max_width({ row_width, content_floor: floor, other_width: SHELL_SIDEBAR_DEFAULT_WIDTH, other_min_width: SHELL_SIDEBAR_MIN_WIDTH });
    const squeezed = max_width < SHELL_BAYBAR_MIN_WIDTH;
    return { max_width, squeezed, min_width: squeezed ? max_width : SHELL_BAYBAR_MIN_WIDTH };
  };
  // 空间充足：下限就是设计值，右栏不会缩到无法阅读，也不算被挤窄。
  for (const row_width of [1600, 1440, floor + SHELL_SIDEBAR_DEFAULT_WIDTH + SHELL_BAYBAR_MIN_WIDTH]) {
    assert.equal(resolve(row_width).min_width, SHELL_BAYBAR_MIN_WIDTH);
    assert.equal(resolve(row_width).squeezed, false, `行宽 ${row_width} 下被误判为「被挤窄」，宽度将不再持久化`);
  }
  // 再少 1px 就装不下了：下限退到上限，并标记为被挤窄。
  const tight = resolve(floor + SHELL_SIDEBAR_DEFAULT_WIDTH + SHELL_BAYBAR_MIN_WIDTH - 1);
  assert.equal(tight.squeezed, true);
  assert.equal(tight.min_width, tight.max_width, "min 大于 max，夹取无解");
});

test("上限随行宽单调变宽，且宽窗口下能超过旧的固定上限", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  const max_widths = [760, 1200, 1920, 2560].map((row_width) => resolve_panel_max_width({
    row_width,
    content_floor: floor,
    other_width: SHELL_SIDEBAR_DEFAULT_WIDTH,
    other_min_width: SHELL_SIDEBAR_MIN_WIDTH,
  }));
  assert.deepEqual(max_widths, [...max_widths].sort((a, b) => a - b));
  // 早期实现写死了 600px 上限；宽窗口下必须能超过它，否则右栏依旧拖不开。
  assert.ok(max_widths.at(-1)! > 600, `宽窗口下上限仍被封在 ${max_widths.at(-1)}`);
});

/**
 * 两侧拖到极限时正文都不低于下限，另一侧也不低于自己的最小宽度。
 *
 * 回归守卫：可用宽度曾经把 Sidebar 一起量了进去，于是上限多出一个 Sidebar 的宽度，
 * 用户能把右栏拖到把正文压到下限以下——而界面上看不出任何异常。
 * 这里对**两侧各自**验一遍，因为它们现在共用同一条规则，一边错就是两边错。
 */
test("拖到极限时正文与另一侧都守住了自己的下限", () => {
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  for (const row_width of [1440, 1920, 2560]) {
    for (const other_width of [SHELL_SIDEBAR_MIN_WIDTH, 280, 520]) {
      // 任一侧拖到上限时：正文恰好停在下限（上限就是这么算出来的）。
      const max_width = resolve_panel_max_width({ row_width, content_floor: floor, other_width, other_min_width: SHELL_SIDEBAR_MIN_WIDTH });
      assert.equal(row_width - max_width - other_width, floor, `行宽 ${row_width} / 另一侧 ${other_width} 下拖满后正文没有停在下限`);
      // 另一侧当前折叠（实测 0）时，仍为它预留最小宽度：上限不会把它的位置吃掉。
      const folded_other_max = resolve_panel_max_width({ row_width, content_floor: floor, other_width: 0, other_min_width: SHELL_SIDEBAR_MIN_WIDTH });
      assert.ok(row_width - folded_other_max - SHELL_SIDEBAR_MIN_WIDTH >= floor, `行宽 ${row_width} 下另一侧折叠时位置被本侧吃掉`);
    }
  }
});

test("正常窗口下两侧拖拽上限都大于各自的最小宽度，否则拖不动", () => {
  // 回归守卫：曾经把可用宽度错量成面板自身宽度（ref 挂在了内层 div 上，父层就是面板自己），
  // 收起时量到 0，上限被夹到 0 与最小宽度相等，拖拽完全失效且界面上看不出原因。
  const floor = SHELL_MAIN_VIEW_MIN_REGION;
  for (const row_width of [1440, 1920, 2560]) {
    const sidebar_max = resolve_panel_max_width({ row_width, content_floor: floor, other_width: SHELL_BAYBAR_DEFAULT_WIDTH, other_min_width: SHELL_BAYBAR_MIN_WIDTH });
    const baybar_max = resolve_panel_max_width({ row_width, content_floor: floor, other_width: SHELL_SIDEBAR_DEFAULT_WIDTH, other_min_width: SHELL_SIDEBAR_MIN_WIDTH });
    assert.ok(sidebar_max > SHELL_SIDEBAR_MIN_WIDTH, `行宽 ${row_width} 下侧栏上限只有 ${sidebar_max}，拖不动`);
    assert.ok(baybar_max > SHELL_BAYBAR_MIN_WIDTH, `行宽 ${row_width} 下右栏上限只有 ${baybar_max}，拖不动`);
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
