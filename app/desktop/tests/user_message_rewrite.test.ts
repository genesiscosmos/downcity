/** 用户消息编辑提交规则测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolve_user_message_rewrite } from "../src/renderer/lib/chat/user_message_rewrite.ts";

test("最后一条消息直接替换当前 Session", () => {
  assert.equal(resolve_user_message_rewrite(true), "rollback");
});

test("历史消息发送前需要选择分支或删除后续消息", () => {
  assert.equal(resolve_user_message_rewrite(false), "choose");
});
