/**
 * Desktop Chat 滚动策略纯函数测试。
 *
 * 两条判定服务的对象不同，必须分开守：
 * 1. **自动跟随**由用户意图决定——向上滑 1px 就停，这是灵敏度问题（晚一步就会和用户的
 *    滚动抢视口），所以阈值只用来吸收抖动；
 * 2. **回到最新的入口**由距离决定——只有最新内容真的滑出视野才该出现。
 *
 * 两者相等时，向上滚 81px 就会冒出按钮，而视口高数百像素、底部内容仍一目了然。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  chat_latest_visible_threshold,
  chat_scroll_intent_tolerance,
  chat_sticky_threshold,
  is_chat_latest_visible,
  is_chat_scroll_sticky,
  is_chat_scroll_up_intent,
  is_programmatic_scroll_top,
  resolve_chat_anchor_scroll_top,
  resolve_chat_follow_indicator,
} from "../src/renderer/features/chat/lib/chat_scroll.ts";

/** 构造一段距底部恰好 `distance` 像素的滚动几何。 */
function metrics_at_distance(distance: number) {
  return { scroll_height: 1000, scroll_top: 600 - distance, client_height: 400 };
}

test("距离底部小于阈值时保持自动跟随", () => {
  assert.equal(is_chat_scroll_sticky({ scroll_height: 1000, scroll_top: 521, client_height: 400 }), true);
  assert.equal(is_chat_scroll_sticky({ scroll_height: 1000, scroll_top: 520, client_height: 400 }), false);
});

test("历史前插后按同一消息行偏移恢复滚动位置", () => {
  assert.equal(resolve_chat_anchor_scroll_top(320, 24, 264), 560);
  assert.equal(resolve_chat_anchor_scroll_top(20, 50, 10), 0);
});

test("亚像素向上位移不构成用户浏览意图", () => {
  // 浏览器锚定修正与亚像素取整会读成向上位移；误判会无声关掉自动跟随。
  assert.equal(is_chat_scroll_up_intent(500, 500), false);
  assert.equal(is_chat_scroll_up_intent(500, 500 - chat_scroll_intent_tolerance), false);
  assert.equal(is_chat_scroll_up_intent(500, 500 - chat_scroll_intent_tolerance - 0.5), true);
  assert.equal(is_chat_scroll_up_intent(500, 640), false);
});

test("本模块写入的滚动位置不被当作用户操作", () => {
  assert.equal(is_programmatic_scroll_top(640, 640), true);
  assert.equal(is_programmatic_scroll_top(640, 639.5), true);
  // 用户接着滚动到明显不同的位置时必须恢复为用户意图。
  assert.equal(is_programmatic_scroll_top(640, 600), false);
  assert.equal(is_programmatic_scroll_top(undefined, 600), false);
});

test("入口阈值明显大于跟随阈值，中间留出滞回区间", () => {
  // 相等就会退回「刚离开底部、底部内容还在眼前就弹按钮」。
  assert.ok(chat_latest_visible_threshold > chat_sticky_threshold * 2, `入口阈值只有 ${chat_latest_visible_threshold}px，滞回区间太窄`);
});

test("还有余量时算作最新内容可见", () => {
  assert.equal(is_chat_latest_visible(metrics_at_distance(0)), true);
  // 跟随已经停止（超过 80px），但底部内容仍在眼前：入口不该出现。
  assert.equal(is_chat_scroll_sticky(metrics_at_distance(chat_sticky_threshold + 1)), false);
  assert.equal(is_chat_latest_visible(metrics_at_distance(chat_sticky_threshold + 1)), true);
  assert.equal(is_chat_latest_visible(metrics_at_distance(chat_latest_visible_threshold - 1)), true);
});

test("最新内容滑出视野后算作不可见", () => {
  assert.equal(is_chat_latest_visible(metrics_at_distance(chat_latest_visible_threshold)), false);
  assert.equal(is_chat_latest_visible(metrics_at_distance(1000)), false);
});

test("内容不足一屏时永远不需要入口", () => {
  // scrollHeight 不超过 clientHeight 时距离为 0。
  assert.equal(is_chat_latest_visible({ scroll_height: 400, scroll_top: 0, client_height: 400 }), true);
});

test("最新内容可见时不展示入口，也不编造数量", () => {
  assert.deepEqual(resolve_chat_follow_indicator({ latest_visible: true, baseline_message_count: 10, message_count: 10 }), { visible: false, new_message_count: 0 });
  // 即使有新消息，只要用户还能看见底部就不展示——那是「你自己没往上滑」的情形。
  assert.deepEqual(resolve_chat_follow_indicator({ latest_visible: true, baseline_message_count: 10, message_count: 14 }), { visible: false, new_message_count: 0 });
});

test("内容滑出视野后展示入口，数量从离开底部那一刻起算", () => {
  assert.deepEqual(resolve_chat_follow_indicator({ latest_visible: false, baseline_message_count: 10, message_count: 12 }), { visible: true, new_message_count: 2 });
  // 只是上滑回看、没有新内容：只提示位置，不报 0 条。
  assert.deepEqual(resolve_chat_follow_indicator({ latest_visible: false, baseline_message_count: 10, message_count: 10 }), { visible: true, new_message_count: 0 });
  // 重写历史消息会让消息数减少；此时应退回「回到最新」，而不是「-1 条新消息」。
  assert.deepEqual(resolve_chat_follow_indicator({ latest_visible: false, baseline_message_count: 10, message_count: 9 }), { visible: true, new_message_count: 0 });
});

test("展示条件不再依赖自动跟随状态", () => {
  // 这条是本组的核心回归点：早先「跟随中 → 隐藏」把两个信号绑在一起，
  // 于是刚离开底部就展示；现在只看距离，参数里根本没有 following。
  const source = resolve_chat_follow_indicator.toString();
  assert.ok(!/\bfollowing\b/.test(source), `展示决策又依赖跟随状态了：${source.slice(0, 120)}`);
});
