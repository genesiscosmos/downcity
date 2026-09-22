/**
 * @file Works 会话树多选纯函数的单测。
 *
 * 重点是**连续 Shift 点击不累积**——这是一个真实出现过的 bug：范围选择曾是并集，
 * 而锚点固定在「当前打开的会话」上，两者相乘导致点几次就把整列选中，
 * 用户看到的是「Shift 点一下，全选了」。下面的用例把这个行为钉住。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  prune_session_selection,
  select_session_range,
  toggle_session_selection,
} from "../src/renderer/layouts/sidebar/sessionSelection.ts";

const ordered = ["a", "b", "c", "d", "e"];

test("切换一条：未选则加入，已选则移除", () => {
  assert.deepEqual(toggle_session_selection([], "b"), ["b"]);
  assert.deepEqual(toggle_session_selection(["b"], "b"), []);
  assert.deepEqual(toggle_session_selection(["a", "c"], "b"), ["a", "c", "b"]);
});

test("范围取锚点与当前项之间的连续段，且按列表顺序", () => {
  // 正向：a → c
  assert.deepEqual(select_session_range(ordered, "a", "c"), ["a", "b", "c"]);
  // 反向拖选与正向是同一段：c → a
  assert.deepEqual(select_session_range(ordered, "c", "a"), ["a", "b", "c"]);
});

test("范围按列表顺序输出，不按点击顺序", () => {
  // 结果是稳定引用：行组件的 memo 靠引用比较，顺序一变它就会失效。
  const result = select_session_range(ordered, "d", "b");
  assert.deepEqual(result, ["b", "c", "d"]);
  assert.deepEqual(result, [...result].sort((left, right) => ordered.indexOf(left) - ordered.indexOf(right)));
});

test("范围是替换，不是并集", () => {
  // 并集会让连续 Shift 点击一路累积成整列——那正是被修掉的 bug。
  // 函数签名里已经没有「已有选择」这个输入，这条用例把该约束钉在行为上。
  assert.deepEqual(select_session_range(ordered, "a", "b"), ["a", "b"]);
});

/**
 * 连续 Shift 点击的完整序列，直接模拟 hook 的锚点规则。
 *
 * 规则：范围用**点击前**的锚点算，算完锚点移到被点项（Shift 也不例外）。
 * 因此每次 Shift 的范围是「上一次点击的 item 到这一项」。
 */
test("连续 Shift 点击是逐段选择，不累积", () => {
  /** 模拟 hook：范围用点击前的锚点，随后锚点前进到被点项。 */
  const click = (state: { selection: string[]; anchor: string | null }, key: string, shift: boolean) => ({
    selection: shift ? select_session_range(ordered, state.anchor, key) : toggle_session_selection(state.selection, key),
    anchor: key,
  });

  // 点 a（普通），Shift 点 c → a..c
  let state = click({ selection: [], anchor: null }, "a", false);
  assert.deepEqual(state.selection, ["a"]);
  state = click(state, "c", true);
  assert.deepEqual(state.selection, ["a", "b", "c"], "第一次 Shift 范围不对");

  // 再 Shift 点 e：锚点已前进到 c → c..e，而不是 a..e（更不是整列）
  state = click(state, "e", true);
  assert.deepEqual(state.selection, ["c", "d", "e"], "连续 Shift 把范围累积成了整列");
});

test("普通点击后锚点也前进，下一次 Shift 从新锚点开始", () => {
  // 点 d（普通）后 Shift 点 b → b..d，与上一次选择无关。
  let state = { selection: toggle_session_selection([], "a"), anchor: "a" as string | null };
  state = { selection: toggle_session_selection(state.selection, "d"), anchor: "d" };
  assert.deepEqual(select_session_range(ordered, state.anchor, "b"), ["b", "c", "d"]);
});

test("锚点失效时退化成只选当前项", () => {
  // 锚点指向的会话可能在选中过程中被删除。
  assert.deepEqual(select_session_range(ordered, "gone", "c"), ["c"]);
  assert.deepEqual(select_session_range(ordered, null, "c"), ["c"]);
});

test("当前项不在可见列表里时也退化成只选当前项", () => {
  assert.deepEqual(select_session_range(ordered, "a", "gone"), ["gone"]);
});

test("锚点与当前项相同时只选这一条", () => {
  assert.deepEqual(select_session_range(ordered, "c", "c"), ["c"]);
});

test("剔除已经不在可见列表里的选择", () => {
  // 会话被删除、切走 Workspace 之后，选择里不该留下指向不存在行的 key。
  assert.deepEqual(prune_session_selection(["a", "gone", "c"], ordered), ["a", "c"]);
  assert.deepEqual(prune_session_selection(["a", "b"], ordered), ["a", "b"]);
  assert.deepEqual(prune_session_selection(["gone"], ordered), []);
});
