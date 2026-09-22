/**
 * @file Works 会话列表分页的单测。
 *
 * 重点是**窗口必须覆盖「用户正在处理的东西」**：当前打开的会话与已选中的会话
 * 即使在默认窗口之外也必须可见，否则侧栏会看不到自己在哪一条、工具条的计数也会
 * 比看得见的勾选多。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  next_page_count,
  resolve_must_include_index,
  resolve_visible_count,
  session_page_size,
} from "../src/renderer/layouts/sidebar/workspaceSessionPaging.ts";

/** 造一串按顺序排列的 key。 */
function keys(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `s${index}`);
}

test("一页是 10 条", () => {
  assert.equal(session_page_size, 10);
});

test("默认只显示一页", () => {
  // 没加载过、也没有必须可见项：窗口就是一页。
  assert.equal(resolve_visible_count({ loaded_count: 0, total_count: 100, must_include_index: null }), 10);
});

test("总数少于一页时显示全部", () => {
  assert.equal(resolve_visible_count({ loaded_count: 0, total_count: 3, must_include_index: null }), 3);
  assert.equal(resolve_visible_count({ loaded_count: 0, total_count: 0, must_include_index: null }), 0);
});

test("加载过之后按加载的条数显示", () => {
  assert.equal(resolve_visible_count({ loaded_count: 20, total_count: 100, must_include_index: null }), 20);
  // 加载数超过总数时封顶到总数。
  assert.equal(resolve_visible_count({ loaded_count: 200, total_count: 42, must_include_index: null }), 42);
});

test("必须可见项在窗口之外时，窗口扩到它", () => {
  // 重启后恢复到第 30 条：侧栏必须能看到自己在哪一条。
  assert.equal(resolve_visible_count({ loaded_count: 0, total_count: 100, must_include_index: 29 }), 30);
  // 已选中的项同理：否则工具条的计数会比看得见的勾选多。
  assert.equal(resolve_visible_count({ loaded_count: 0, total_count: 100, must_include_index: 15 }), 16);
});

test("必须可见项在窗口之内时不额外扩大", () => {
  // 它已经在第一页里，窗口就还是一页。
  assert.equal(resolve_visible_count({ loaded_count: 0, total_count: 100, must_include_index: 3 }), 10);
  assert.equal(resolve_visible_count({ loaded_count: 0, total_count: 100, must_include_index: 9 }), 10);
});

test("必须可见项与已加载条数取较大者", () => {
  // 已经加载了 20 条，而必须可见项在第 5 条：窗口仍是 20。
  assert.equal(resolve_visible_count({ loaded_count: 20, total_count: 100, must_include_index: 4 }), 20);
  // 反过来：必须可见项在第 40 条，窗口扩到 41。
  assert.equal(resolve_visible_count({ loaded_count: 20, total_count: 100, must_include_index: 40 }), 41);
});

test("下标越界时封顶到总数", () => {
  // 脏数据或竞态下可能给出一个超出长度的下标；不能算出一个比实际还长的窗口。
  assert.equal(resolve_visible_count({ loaded_count: 0, total_count: 5, must_include_index: 99 }), 5);
});

test("取「必须可见项」的下标：当前打开与已选中里最靠后的那个", () => {
  const ordered = keys(20);
  // 只算当前打开项。
  assert.equal(resolve_must_include_index({ ordered_keys: ordered, active_key: "s3", selected_keys: [] }), 3);
  // 只算已选项。
  assert.equal(resolve_must_include_index({ ordered_keys: ordered, active_key: undefined, selected_keys: ["s7", "s2"] }), 7);
  // 两者都有时取较大的那个：两个都要看得见。
  assert.equal(resolve_must_include_index({ ordered_keys: ordered, active_key: "s4", selected_keys: ["s12"] }), 12);
});

test("没有任何必须可见项时返回 null", () => {
  const ordered = keys(20);
  assert.equal(resolve_must_include_index({ ordered_keys: ordered, selected_keys: [] }), null);
  // 不在列表里的 key 不算数：它们本来就不会被渲染。
  assert.equal(resolve_must_include_index({ ordered_keys: ordered, active_key: "gone", selected_keys: ["also-gone"] }), null);
});

test("加载下一页：加一页，且不超过总数", () => {
  assert.equal(next_page_count(10, 100), 20);
  assert.equal(next_page_count(10, 15), 15);
  assert.equal(next_page_count(10, 10), 10);
  // 从 0 开始也走一页。
  assert.equal(next_page_count(0, 100), 10);
});
