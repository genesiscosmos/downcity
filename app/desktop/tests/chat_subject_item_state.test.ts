/** Chat Sidebar 主体行右侧菜单状态测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { is_persistent_chat_subject_menu_status, resolve_chat_subject_menu_status } from "../src/renderer/layouts/sidebar/chat_subject_item_state.ts";

test("运行状态优先于未读状态并持续显示 Spinner", () => {
  const status = resolve_chat_subject_menu_status({ running: true, unread: true });
  assert.equal(status, "running");
  assert.equal(is_persistent_chat_subject_menu_status(status), true);
});

test("非运行状态的未读结果持续显示蓝点", () => {
  const status = resolve_chat_subject_menu_status({ running: false, unread: true });
  assert.equal(status, "unread");
  assert.equal(is_persistent_chat_subject_menu_status(status), true);
});

test("普通状态只显示按交互触发的省略号", () => {
  const status = resolve_chat_subject_menu_status({ running: false, unread: false });
  assert.equal(status, "idle");
  assert.equal(is_persistent_chat_subject_menu_status(status), false);
});

test("菜单状态输入不包含 Item active，选中状态不能影响显隐", () => {
  assert.deepEqual(
    resolve_chat_subject_menu_status({ running: false, unread: false }),
    "idle",
  );
});
