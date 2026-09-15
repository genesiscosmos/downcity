/** Desktop Chat 滚动策略纯函数测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  chat_scroll_intent_tolerance,
  is_chat_scroll_sticky,
  is_chat_scroll_up_intent,
  is_programmatic_scroll_top,
  resolve_chat_anchor_scroll_top,
} from "../src/renderer/features/chat/lib/chat_scroll.ts";

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
