/**
 * 右侧 BayBar 的标签页模型与纯规则测试。
 *
 * 直接验证生产模块，锁定四条最容易写错的不变量：
 * 1. 关掉最后一个标签页会**收起面板**，并清空当前标签页——面板存在的理由就是承载标签页；
 * 2. 其余关闭只换当前页：接替规则明确（右侧优先，其次左侧），面板开合不变；
 * 3. 分区沿用上次、失效时回退到第一个，不让用户看到空面板；
 * 4. 标题同步只改 label，不重建内容。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  apply_tab_label,
  baybar_open_storage_key,
  baybar_tab_id,
  parse_stored_flag,
  resolve_after_close,
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

test("关掉最后一个标签页时收起面板并清空当前标签页", () => {
  // 面板存在的理由就是承载标签页；没有标签页时继续占宽度只会挤正文。
  // 同时必须清空 active_id：留一个已失效的 id，下次展开会先渲染一帧空内容。
  assert.deepEqual(resolve_after_close({ tab_ids: ["agent:a1"], active_id: "agent:a1", open: true, closing_id: "agent:a1" }), { active_id: null, open: false });
});

test("还有其它标签页时关闭不收起面板", () => {
  const next = resolve_after_close({ tab_ids: ["a", "b"], active_id: "a", open: true, closing_id: "b" });
  assert.equal(next.open, true);
  assert.equal(next.active_id, "a");
});

test("关掉非当前标签页时不改变当前标签页", () => {
  assert.equal(resolve_after_close({ tab_ids: ["a", "b", "c"], active_id: "b", open: true, closing_id: "c" }).active_id, "b");
});

test("关掉当前标签页时接到右侧邻居", () => {
  assert.equal(resolve_after_close({ tab_ids: ["a", "b", "c"], active_id: "a", open: true, closing_id: "a" }).active_id, "b");
  assert.equal(resolve_after_close({ tab_ids: ["a", "b", "c"], active_id: "b", open: true, closing_id: "b" }).active_id, "c");
});

test("没有右侧邻居时接到左侧", () => {
  assert.equal(resolve_after_close({ tab_ids: ["a", "b", "c"], active_id: "c", open: true, closing_id: "c" }).active_id, "b");
});

test("关闭标签页不改变面板收起状态", () => {
  // 用户在窄窗口下被自动收起时，关一个标签页不该把面板“顺带”拉出来。
  assert.equal(resolve_after_close({ tab_ids: ["a", "b"], active_id: "a", open: false, closing_id: "b" }).open, false);
});

test("分区沿用上次的选择", () => {
  assert.equal(resolve_section(agent_tab, "soul")?.id, "soul");
});

test("没记录过分区时落在第一个", () => {
  assert.equal(resolve_section(agent_tab, null)?.id, "identity");
  assert.equal(resolve_section(agent_tab, undefined)?.id, "identity");
});

test("记录的分区消失时回退到第一个，而不是显示空面板", () => {
  assert.equal(resolve_section(agent_tab, "powers")?.id, "identity");
});

test("标签页没有分区时不给出内容", () => {
  assert.equal(resolve_section(tab("empty", []), null), null);
});

test("刷新标题只改 label，sections 与 icon 原样保留", () => {
  // 这条守的是一个真实约束：sections 换新元素会让 React 重新挂载内容组件，
  // 而输入区展开后正在编辑的草稿就在那些组件里——标题同步不该把输入内容冲掉。
  const content = null;
  const original: BayBarTab = { id: "composer:s1", label: "新对话", icon: null, sections: [{ id: "composer", label: "输入", content }] };
  const [next] = apply_tab_label([original], "composer:s1", "修复登录超时");

  assert.equal(next?.label, "修复登录超时");
  assert.equal(next?.sections, original.sections, "sections 引用变了：内容组件会被重新挂载");
  assert.equal(next?.sections[0]?.content, content, "内容元素被重建：编辑中的状态会丢");
  assert.equal(next?.icon, original.icon);
});

test("标题未变或标签页不存在时返回原数组，供调用方跳过提交", () => {
  const tabs: BayBarTab[] = [tab("composer:s1", ["composer"])];
  // 返回原引用是「无需提交」的表达方式；store 据此不再通知订阅者，避免多余渲染。
  assert.equal(apply_tab_label(tabs, "composer:s1", "composer:s1"), tabs);
  assert.equal(apply_tab_label(tabs, "composer:missing", "新标题"), tabs);
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
