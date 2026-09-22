/**
 * @file Works 会话树折叠状态的单测。
 *
 * 重点是**不可信输入**：`localStorage` 里的内容可能被手改、被旧版本写过、或跨版本留下
 * 已经删除的 Workspace id。这类边界靠渲染验证很贵，而它们恰好最容易写错。
 * 这几个函数不引入 React 运行时，因此可以直接跑。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  format_expanded_ids,
  parse_expanded_ids,
  prune_expanded_ids,
  resolve_initial_expanded_ids,
} from "../src/renderer/layouts/sidebar/workspaceExpansion.ts";

test("解析存储内容：只接受非空字符串数组", () => {
  assert.deepEqual(parse_expanded_ids(JSON.stringify(["a", "b"])), ["a", "b"]);
  // 空集合是合法值：它表示用户把全部都折叠了。
  assert.deepEqual(parse_expanded_ids(JSON.stringify([])), []);
});

test("解析存储内容：坏数据当作「没存过」，而不是抛错", () => {
  // 折叠状态坏了不该让侧栏打不开。
  assert.deepEqual(parse_expanded_ids(null), []);
  assert.deepEqual(parse_expanded_ids(""), []);
  assert.deepEqual(parse_expanded_ids("not-json"), []);
  assert.deepEqual(parse_expanded_ids(JSON.stringify({ a: 1 })), []);
  assert.deepEqual(parse_expanded_ids(JSON.stringify("a")), []);
  assert.deepEqual(parse_expanded_ids(JSON.stringify([1, null, true])), []);
  // 数组里的合法项保留，非法项剔除。
  assert.deepEqual(parse_expanded_ids(JSON.stringify(["a", 2, "", null, "b"])), ["a", "b"]);
});

test("序列化与解析互逆", () => {
  const ids = ["one", "two"];
  assert.deepEqual(parse_expanded_ids(format_expanded_ids(ids)), ids);
  // 空集合也要能往返：否则「全部折叠」会在重新挂载后回到默认。
  assert.deepEqual(parse_expanded_ids(format_expanded_ids([])), []);
});

test("剔除已不存在的 Workspace", () => {
  // 不清掉的话集合会一直变大，而且重新添加同名目录时会被莫名其妙地自动展开。
  assert.deepEqual(prune_expanded_ids(["a", "gone", "b"], ["a", "b", "c"]), ["a", "b"]);
  assert.deepEqual(prune_expanded_ids(["gone"], ["a"]), []);
});

test("初始展开 = 存储那一份 ∪ 当前所在", () => {
  const resolved = resolve_initial_expanded_ids({
    stored_ids: ["a", "b"],
    workspace_ids: ["a", "b", "c"],
    selected_workspace_id: "c",
  });
  // 存储那一份是用户上次的选择；当前所在的必须补上。
  assert.deepEqual([...resolved].sort(), ["a", "b", "c"]);
});

test("没存过时只展开当前所在的那个", () => {
  // 与加持久化之前的行为一致。
  const resolved = resolve_initial_expanded_ids({
    stored_ids: [],
    workspace_ids: ["a", "b"],
    selected_workspace_id: "b",
  });
  assert.deepEqual([...resolved], ["b"]);
});

test("存储里的失效 id 不会带进初始值", () => {
  const resolved = resolve_initial_expanded_ids({
    stored_ids: ["gone", "a"],
    workspace_ids: ["a"],
    selected_workspace_id: undefined,
  });
  assert.deepEqual([...resolved], ["a"]);
});

test("当前所在的 Workspace 已被移除时不补", () => {
  const resolved = resolve_initial_expanded_ids({
    stored_ids: ["a"],
    workspace_ids: ["a"],
    selected_workspace_id: "gone",
  });
  assert.deepEqual([...resolved], ["a"]);
});

test("没有当前项时只取存储那一份", () => {
  const resolved = resolve_initial_expanded_ids({
    stored_ids: ["a", "b"],
    workspace_ids: ["a", "b"],
    selected_workspace_id: undefined,
  });
  assert.deepEqual([...resolved].sort(), ["a", "b"]);
});
