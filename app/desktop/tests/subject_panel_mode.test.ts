/**
 * @file 主体行会话面板的状态机：**折叠 → 浮动 → 嵌入 → 折叠**，以及两种展开态的并存规则。
 *
 * ## 为什么单独测这层
 *
 * 「点一次头像会到哪」是这次交互的全部契约，而它现在是一个三态循环。三种状态里有两个
 * 看起来都像「展开」，差别只在卡片在不在文档流里，所以单靠看界面很难在回归时发现问题。
 *
 * `subjectCard.ts` 里那几个纯函数没有 DOM 依赖，因此这里不需要渲染环境就能测干净——
 * 这也是把状态推进做成纯函数、而不是散在组件里的主要理由。
 *
 * ## 本文件最重要的一节：嵌入态的独立性
 *
 * 初始实现把「展开的是谁」和「怎么展开」压成一个值，于是全列表同时只能开一个面板。
 * 那个默认对浮动是对的（它绝对定位、会盖住下面的行），对嵌入是错的：嵌入在列表流里
 * 各占一段，本来就该能并存。下面“嵌入態相互独立”那一节把这条钉住。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  advance_open_panels,
  docked_visible_session_count,
  no_open_panels,
  panel_mode_of,
  retain_open_panels,
  set_open_panel_mode,
  split_visible_sessions,
  type OpenPanels,
} from "../src/renderer/layouts/sidebar/subjectCard.ts";

/** 从空集开始连点头像，收集每一步之后某个主体的状态。 */
function click_avatar(key: string, times: number): ReturnType<typeof panel_mode_of>[] {
  const seen: ReturnType<typeof panel_mode_of>[] = [];
  let panels: OpenPanels = no_open_panels;
  for (let step = 0; step < times; step += 1) {
    panels = advance_open_panels(panels, key);
    seen.push(panel_mode_of(panels, key));
  }
  return seen;
}

test("头像点击按 折叠 → 浮动 → 嵌入 → 折叠 循环", () => {
  assert.deepEqual(click_avatar("a", 3), ["floating", "docked", null]);
});

test("第三次点击回到起点：循环没有断点，也没有第四个状态", () => {
  // 再点一轮必须与第一轮完全一致；写死某个状态就会在这里露出来。
  assert.deepEqual(click_avatar("a", 6), ["floating", "docked", null, "floating", "docked", null]);
});

test("浮动是默认的第一次展开", () => {
  // 第一次点击不能直接嵌入：嵌入会推开后面的主体，那一跳应该是用户**再点一次**才换来的。
  assert.equal(panel_mode_of(advance_open_panels(no_open_panels, "a"), "a"), "floating");
});

test("从嵌入收起只需一次点击", () => {
  // 嵌入态是最“重”的状态，退出它不能比进入它还贵。
  const docked = advance_open_panels(advance_open_panels(no_open_panels, "a"), "a");
  assert.equal(panel_mode_of(advance_open_panels(docked, "a"), "a"), null);
});

/** 多个嵌入的面板同时存在，而且互不影响——这是这套交互的核心诉求。 */
test("嵌入态相互独立：可以同时固定多个，动一个不影响其它", () => {
  const two_docked = ["a", "b"].reduce(
    (panels, key) => advance_open_panels(advance_open_panels(panels, key), key),
    no_open_panels,
  );
  assert.equal(panel_mode_of(two_docked, "a"), "docked");
  assert.equal(panel_mode_of(two_docked, "b"), "docked");

  // 再嵌入第三个，前两个不动。
  const three_docked = advance_open_panels(advance_open_panels(two_docked, "c"), "c");
  assert.deepEqual(three_docked.docked_keys, ["a", "b", "c"]);

  // 收起中间那个，另外两个仍然是嵌入态。
  const without_b = advance_open_panels(three_docked, "b");
  assert.equal(panel_mode_of(without_b, "b"), null);
  assert.equal(panel_mode_of(without_b, "a"), "docked");
  assert.equal(panel_mode_of(without_b, "c"), "docked");
  assert.deepEqual(without_b.docked_keys, ["a", "c"]);
});

test("浮动至多一个：开新的浮动会挤掉旧的，但不会碰嵌入的那些", () => {
  // a 嵌入、b 浮动；再点 c 让它浮动。
  let panels = advance_open_panels(advance_open_panels(no_open_panels, "a"), "a");
  panels = advance_open_panels(panels, "b");
  assert.equal(panel_mode_of(panels, "b"), "floating");

  panels = advance_open_panels(panels, "c");
  assert.equal(panel_mode_of(panels, "c"), "floating");
  // 旧的浮动只是回到折叠——不能变成嵌入（用户没要过那个固定面板）。
  assert.equal(panel_mode_of(panels, "b"), null);
  assert.deepEqual(panels.docked_keys, ["a"]);
  assert.equal(panel_mode_of(panels, "a"), "docked");
});

test("同一个主体不会既浮动又嵌入", () => {
  // 先嵌入再把它设成浮动：必须从 docked 里摘掉，而不是两边都留一份。
  const panels = set_open_panel_mode(advance_open_panels(advance_open_panels(no_open_panels, "a"), "a"), "a", "floating");
  assert.equal(panel_mode_of(panels, "a"), "floating");
  assert.deepEqual(panels.docked_keys, []);
});

test("收起只认目标那一个：回调顺序不影响结果", () => {
  // 真实点击里，按下另一个头像会先触发一次“点外部收起”，再推进那一个。
  // 两步都只针对各自的目标，因此合起来等于“换一个浮动”。
  const docked = advance_open_panels(advance_open_panels(no_open_panels, "a"), "a");
  const floating_b = advance_open_panels(docked, "b");
  // 先收起（可能来自点外部），再开 c。
  const after_outside_click = set_open_panel_mode(floating_b, "b", null);
  assert.equal(panel_mode_of(after_outside_click, "b"), null);
  assert.equal(panel_mode_of(after_outside_click, "a"), "docked");
  assert.equal(panel_mode_of(advance_open_panels(after_outside_click, "c"), "c"), "floating");
});

test("主体离开列表后它那份开合状态被丢掉", () => {
  // 不清理的话，同一个 key 将来被复用时（key 是拼出来的）会“记得”之前是展开的。
  const panels = advance_open_panels(advance_open_panels(no_open_panels, "a"), "a");
  const with_float = advance_open_panels(panels, "b");
  const retained = retain_open_panels(with_float, ["b"]);
  assert.deepEqual(retained.docked_keys, []);
  assert.equal(retained.floating_key, "b");
  assert.equal(panel_mode_of(retained, "a"), null);
  // 全都没了就回到空集。
  assert.deepEqual(retain_open_panels(with_float, []), no_open_panels);
});

test("没有变化时原样返回入参，引用稳定", () => {
  // 调用方拿它做派生值的依赖；每次新建对象会让下面的投影白算。
  const panels = advance_open_panels(advance_open_panels(no_open_panels, "a"), "a");
  assert.equal(retain_open_panels(panels, ["a", "b"]), panels);
  // 真的丢了东西才换新对象。
  assert.notEqual(retain_open_panels(panels, ["b"]), panels);
});

/**
 * 嵌入态的条数上限：最多直接列出 4 条，其余走「全部对话」菜单。
 *
 * 封顶的理由见 `docked_visible_session_count`：嵌入长期占位，条数就是永久从主体列表里
 * 拿走的高度；不封顶时一个开了 30 条会话的 Agent 会把其余主体全部推出屏幕。
 */
test("嵌入态只直接列出 4 条", () => {
  assert.equal(docked_visible_session_count, 4);
  const sessions = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const { visible, has_more } = split_visible_sessions(sessions, docked_visible_session_count);
  assert.deepEqual(visible, ["s1", "s2", "s3", "s4"]);
  assert.equal(has_more, true);
});

test("条数不超过上限时不出现「全部对话」入口", () => {
  // 否则会出现一条“全部 4 个对话”而上面已经列了 4 条的重复入口。
  for (const count of [0, 1, 4]) {
    const sessions = Array.from({ length: count }, (_, index) => `s${index + 1}`);
    const { visible, has_more } = split_visible_sessions(sessions, docked_visible_session_count);
    assert.equal(visible.length, count, `${count} 条时可见数不对`);
    assert.equal(has_more, false, `${count} 条时不该出现「全部对话」入口`);
  }
  // 恰好 5 条（上限 + 1）是第一个该出现它的点。
  assert.equal(split_visible_sessions(["s1", "s2", "s3", "s4", "s5"], 4).has_more, true);
});

test("浮动态不传上限，因此全部直接列出", () => {
  // 浮动点外部就收，高度不是长期代价，不需要上限；它靠 max-h-80 滚动兜住。
  const sessions = Array.from({ length: 30 }, (_, index) => `s${index + 1}`);
  const { visible, has_more } = split_visible_sessions(sessions);
  assert.equal(visible.length, 30);
  assert.equal(has_more, false);
  // 不传上限时可见列表就是原数组本身（引用不变，不必复制）。
  assert.equal(visible, sessions);
});
