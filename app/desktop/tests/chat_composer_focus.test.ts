/** Desktop 新建对话后的输入聚焦意图测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { read_composer_focus_request, request_composer_focus, should_apply_composer_focus } from "../src/renderer/features/chat/composer/editor/composerFocus.ts";

test("新建对话在同一对话上重复请求时序号递增，从而再次生效", () => {
  const first = request_composer_focus({}, "session|draft");
  const second = request_composer_focus(first, "session|draft");

  assert.equal(read_composer_focus_request(first, "session|draft"), 1);
  assert.equal(read_composer_focus_request(second, "session|draft"), 2);
  assert.equal(should_apply_composer_focus(1, 0), true);
  assert.equal(should_apply_composer_focus(2, 1), true);
});

test("聚焦请求只属于被请求的对话", () => {
  const state = request_composer_focus({}, "session|a");

  assert.equal(read_composer_focus_request(state, "session|b"), 0);
  assert.equal(should_apply_composer_focus(read_composer_focus_request(state, "session|b"), 0), false);
});

test("已处理过的请求不会因为重渲染重复聚焦", () => {
  assert.equal(should_apply_composer_focus(1, 1), false);
  assert.equal(should_apply_composer_focus(0, 0), false);
});
