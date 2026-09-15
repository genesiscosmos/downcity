/** Chat 侧栏文件面板持久化状态测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { chat_file_panel_storage_key, format_chat_panel_file, parse_chat_panel_file } from "../src/renderer/features/chat/panel/chat_file_panel_state.ts";

test("按 Chat 视图隔离存储键", () => {
  assert.notEqual(chat_file_panel_storage_key("agent-session:a:s1"), chat_file_panel_storage_key("agent-session:a:s2"));
});

test("打开的文件可以往返序列化", () => {
  const file = { relative_path: "src/index.ts", line: 45 };
  assert.deepEqual(parse_chat_panel_file(format_chat_panel_file(file)), file);
  assert.deepEqual(parse_chat_panel_file(format_chat_panel_file({ relative_path: "README.md" })), { relative_path: "README.md" });
});

test("结构不合法时回到空态", () => {
  assert.equal(parse_chat_panel_file(null), undefined);
  assert.equal(parse_chat_panel_file("not-json"), undefined);
  assert.equal(parse_chat_panel_file(JSON.stringify({})), undefined);
  assert.equal(parse_chat_panel_file(JSON.stringify({ relative_path: "" })), undefined);
});

test("非法行号被忽略但不影响文件本身", () => {
  assert.deepEqual(parse_chat_panel_file(JSON.stringify({ relative_path: "src/index.ts", line: "45" })), { relative_path: "src/index.ts" });
  assert.deepEqual(parse_chat_panel_file(JSON.stringify({ relative_path: "src/index.ts", line: 0 })), { relative_path: "src/index.ts" });
});
