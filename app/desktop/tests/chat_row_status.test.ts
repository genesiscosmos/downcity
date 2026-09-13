/** Chat 行状态模型测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  chat_row_status_description_key,
  chat_row_status_label_key,
  chat_row_trigger_class_name,
  chat_working_label_key,
  is_chat_row_status_visible,
  resolve_chat_row_status,
} from "../src/renderer/features/chat/lib/chat_row_status.ts";

test("实时状态与未读的等待输入收敛为同一个取值", () => {
  assert.equal(resolve_chat_row_status("action_required", null), "action_required");
  assert.equal(resolve_chat_row_status(null, "action_required"), "action_required");
});

test("实时状态优先于未读历史", () => {
  assert.equal(resolve_chat_row_status("action_required", "completed"), "action_required");
  assert.equal(resolve_chat_row_status("action_required", "failed"), "action_required");
  assert.equal(resolve_chat_row_status("working", "completed"), "working");
  assert.equal(resolve_chat_row_status("working", "action_required"), "working");
});

test("无实时状态时未读结果各自映射到对应取值", () => {
  assert.equal(resolve_chat_row_status(null, "failed"), "failed");
  assert.equal(resolve_chat_row_status(null, "completed"), "completed");
  assert.equal(resolve_chat_row_status(null, null), "idle");
});

test("只有解释此刻原因的状态占用行描述位", () => {
  assert.equal(chat_row_status_description_key("working"), chat_working_label_key);
  assert.equal(chat_row_status_description_key("action_required"), "attention.needs_input");
  assert.equal(chat_row_status_description_key("failed"), null);
  assert.equal(chat_row_status_description_key("completed"), null);
  assert.equal(chat_row_status_description_key("idle"), null);
});

test("非 idle 状态必须持续可见，未读提示不能被 hover 隐藏", () => {
  assert.equal(is_chat_row_status_visible("idle"), false);
  for (const status of ["working", "action_required", "failed", "completed"] as const) {
    assert.equal(is_chat_row_status_visible(status), true);
  }
});

test("每个非 idle 状态都有可读名称", () => {
  assert.equal(chat_row_status_label_key("working"), chat_working_label_key);
  assert.equal(chat_row_status_label_key("action_required"), "attention.needs_input");
  assert.equal(chat_row_status_label_key("failed"), "attention.failed");
  assert.equal(chat_row_status_label_key("completed"), "attention.completed");
});

test("需要用户注意的状态常显，其余状态随 hover 与键盘聚焦显隐", () => {
  assert.equal(chat_row_trigger_class_name("action_required"), "opacity-100");
  assert.equal(chat_row_trigger_class_name("failed"), "opacity-100");
  const idle = chat_row_trigger_class_name("idle");
  assert.match(idle, /group-hover\/item:opacity-100/);
  assert.match(idle, /focus-visible:opacity-100/);
});

test("入口展开态使用 Base UI 的 data-popup-open，不存在 data-state", () => {
  const idle = chat_row_trigger_class_name("idle");
  assert.match(idle, /data-\[popup-open\]:opacity-100/);
  assert.doesNotMatch(idle, /data-\[state=/);
});
