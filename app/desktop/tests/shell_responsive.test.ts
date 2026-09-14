/**
 * 窄窗口自适应与「回到最新」判定测试。
 *
 * 这两条都是「不写测试就一定会写错、而且肉眼不容易发现」的逻辑：
 * 自动收起如果分不清是系统收的还是用户收的，拉宽窗口后侧栏会莫名其妙地消失；
 * 「回到最新」的计数如果基线不对，会报出一个凭空的消息数。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BAYBAR_AUTO_COLLAPSE_WIDTH, SIDEBAR_AUTO_COLLAPSE_WIDTH, resolve_shell_auto_collapse } from "../src/renderer/layouts/shellResponsive.ts";
import { resolve_chat_follow_indicator } from "../src/renderer/features/chat/lib/chat_scroll.ts";

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

test("跟随中不展示回到最新入口", () => {
  assert.deepEqual(resolve_chat_follow_indicator(true, 10, 10), { visible: false, new_message_count: 0 });
  // 即使有新消息，只要用户仍在底部就不该出现入口。
  assert.deepEqual(resolve_chat_follow_indicator(true, 10, 14), { visible: false, new_message_count: 0 });
});

test("离开底部的消息数从离开那一刻起算", () => {
  assert.deepEqual(resolve_chat_follow_indicator(false, 10, 12), { visible: true, new_message_count: 2 });
});

test("只是上滑回看、没有新消息时不报数量", () => {
  assert.deepEqual(resolve_chat_follow_indicator(false, 10, 10), { visible: true, new_message_count: 0 });
});

test("消息被替换或回退时不出现负数", () => {
  // 重写历史消息会让消息数减少；此时应退回「回到最新」，而不是「-1 条新消息」。
  assert.deepEqual(resolve_chat_follow_indicator(false, 10, 9), { visible: true, new_message_count: 0 });
});
