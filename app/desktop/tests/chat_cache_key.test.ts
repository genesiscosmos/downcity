/** Desktop Chat 缓存键编码测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { get_group_chat_key, get_session_key, get_workspace_chat_key_prefixes, is_workspace_chat_key } from "../src/renderer/features/chat/lib/chat_cache_key.ts";
import { remove_record_prefixes } from "../src/renderer/lib/store/record_projection.ts";

test("包含分隔符的不同标识元组不会产生相同缓存键", () => {
  assert.notEqual(
    get_session_key("workspace:a", "agent", "session"),
    get_session_key("workspace", "a:agent", "session"),
  );
  assert.notEqual(
    get_session_key("工作区", "agent:一", "session:一"),
    get_session_key("工作", "区:agent", "一:session:一"),
  );
});

test("Agent Session 与 Group Chat 使用独立命名空间", () => {
  assert.notEqual(
    get_session_key("workspace", "shared", "session"),
    get_group_chat_key("workspace", "shared", "session"),
  );
});

test("Workspace 前缀只移除目标 Workspace 的 Agent 与 Group 缓存", () => {
  const target_session = get_session_key("workspace:a", "agent", "session");
  const target_group = get_group_chat_key("workspace:a", "group", "session");
  const retained = get_session_key("workspace", "a:agent", "session");
  const current = { [target_session]: 1, [target_group]: 2, [retained]: 3 };
  assert.deepEqual(remove_record_prefixes(current, get_workspace_chat_key_prefixes("workspace:a")), { [retained]: 3 });
  assert.equal(remove_record_prefixes(current, get_workspace_chat_key_prefixes("missing")), current);
  assert.equal(is_workspace_chat_key(target_session, "workspace:a"), true);
  assert.equal(is_workspace_chat_key(target_group, "workspace:a"), true);
  assert.equal(is_workspace_chat_key(retained, "workspace:a"), false);
});
