/** Desktop Chat 滚动策略纯函数测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { is_chat_scroll_sticky, resolve_chat_anchor_scroll_top } from "../src/renderer/features/chat/lib/chat_scroll.ts";

test("距离底部小于阈值时保持自动跟随", () => {
  assert.equal(is_chat_scroll_sticky({ scroll_height: 1000, scroll_top: 521, client_height: 400 }), true);
  assert.equal(is_chat_scroll_sticky({ scroll_height: 1000, scroll_top: 520, client_height: 400 }), false);
});

test("历史前插后按同一消息行偏移恢复滚动位置", () => {
  assert.equal(resolve_chat_anchor_scroll_top(320, 24, 264), 560);
  assert.equal(resolve_chat_anchor_scroll_top(20, 50, 10), 0);
});
