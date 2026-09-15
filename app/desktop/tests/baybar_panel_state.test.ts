/**
 * 右侧 BayBar 的标签页模型与纯规则测试。
 *
 * 直接验证生产模块，锁定三条最容易写错的不变量：
 * 1. 关标签页**不会**关面板——所以 `resolve_active_after_close` 的返回值里
 *    根本没有「面板是否展开」这个字段，它在类型上就无法表达「顺带收起」；
 * 2. 关掉当前标签页时接替规则明确（右侧优先，其次左侧，都没有则空着）；
 * 3. 分区沿用上次、失效时回退到第一个，不让用户看到空面板。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  baybar_open_storage_key,
  baybar_tab_id,
  parse_stored_flag,
  resolve_active_after_close,
  resolve_section,
} from "../src/renderer/layouts/baybarPanelState.ts";
import type { BayBarTab } from "../src/renderer/layouts/baybarPanelState.ts";

/** 构造一个标签页。 */
function tab(id: string, section_ids: string[]): BayBarTab {
  return { id, label: id, icon: null, sections: section_ids.map((section_id) => ({ id: section_id, label: section_id, content: null })) };
}

const agent_tab = tab("agent:a1", ["identity", "model", "soul"]);

test("标签页 id 指向具体对象，同类对象的每个实例各占一个", () => {
  assert.equal(baybar_tab_id("agent", "a1"), "agent:a1");
  assert.notEqual(baybar_tab_id("agent", "a1"), baybar_tab_id("agent", "a2"));
  assert.notEqual(baybar_tab_id("agent", "a1"), baybar_tab_id("group", "a1"));
});

test("关掉最后一个标签页时是空着，而不是收起面板", () => {
  // 这是本轮修复的核心：关标签页与开关面板是两个正交维度。
  // 返回值里没有「面板是否展开」——这就是不变量的表达方式。
  assert.equal(resolve_active_after_close(["agent:a1"], "agent:a1", "agent:a1"), null);
});

test("关掉非当前标签页时不改变当前标签页", () => {
  assert.equal(resolve_active_after_close(["a", "b", "c"], "b", "c"), "b");
});

test("关掉当前标签页时接到右侧邻居", () => {
  assert.equal(resolve_active_after_close(["a", "b", "c"], "a", "a"), "b");
  assert.equal(resolve_active_after_close(["a", "b", "c"], "b", "b"), "c");
});

test("没有右侧邻居时接到左侧", () => {
  assert.equal(resolve_active_after_close(["a", "b", "c"], "c", "c"), "b");
});

test("关闭不存在的标签页时不改变当前标签页", () => {
  assert.equal(resolve_active_after_close(["a", "b"], "a", "missing"), "a");
});

test("分区沿用上次的选择", () => {
  assert.equal(resolve_section(agent_tab, "soul")?.id, "soul");
});

test("没记录过分区时落在第一个", () => {
  assert.equal(resolve_section(agent_tab, null)?.id, "identity");
  assert.equal(resolve_section(agent_tab, undefined)?.id, "identity");
});

test("记录的分区消失时回退到第一个，而不是显示空面板", () => {
  assert.equal(resolve_section(agent_tab, "plugins")?.id, "identity");
});

test("标签页没有分区时不给出内容", () => {
  assert.equal(resolve_section(tab("empty", []), null), null);
});

test("开合状态只有明确存过 true 才算展开", () => {
  // 首次打开应用不应主动占用右侧空间。
  assert.equal(parse_stored_flag(null), false);
  assert.equal(parse_stored_flag(""), false);
  assert.equal(parse_stored_flag("1"), false);
  assert.equal(parse_stored_flag("yes"), false);
  assert.equal(parse_stored_flag("true"), true);
});

test("开合状态的存储键是唯一持久化的东西", () => {
  assert.equal(baybar_open_storage_key, "downcity.baybar_open");
});
