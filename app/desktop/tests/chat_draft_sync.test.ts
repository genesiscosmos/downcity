/** Chat 输入草稿跨会话恢复判定测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import type { JSONContent } from "@tiptap/core";
import { should_restore_editor_draft } from "../src/renderer/features/chat/composer/editor/draftSync.ts";

/** 创建可按引用区分的 Tiptap 文档。 */
function create_draft(text: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

test("同一输入目标的本地草稿回写不重复覆盖编辑器", () => {
  const draft = create_draft("A");

  assert.equal(should_restore_editor_draft("session-a", "session-a", draft, draft), false);
});

test("切换输入目标时必须恢复目标草稿", () => {
  const draft = create_draft("A");

  assert.equal(should_restore_editor_draft("session-b", "session-a", draft, draft), true);
});

test("同一输入目标收到外部草稿时重新加载", () => {
  assert.equal(
    should_restore_editor_draft("session-a", "session-a", create_draft("new"), create_draft("old")),
    true,
  );
});
