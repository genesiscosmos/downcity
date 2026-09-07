/** Desktop Chat 输入草稿持久化记录校验测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { chat_composer_schema_version, parse_persisted_chat_draft, project_persisted_chat_drafts } from "../src/renderer/features/chat/composer/storage/chatComposerStorage.ts";

/** 创建一条可恢复的持久化记录。 */
function create_record(session_key: string, text: string) {
  return {
    schema_version: chat_composer_schema_version,
    session_key,
    draft: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    updated_at: 1,
  };
}

test("恢复完整 Tiptap 文档并按 Session 组合键投影", () => {
  const text_record = create_record("session|1:w|1:a|1:s", "继续输入");
  const attachment_record = {
    ...create_record("group|1:w|1:g|1:s", ""),
    draft: { type: "doc", content: [{ type: "paragraph", content: [{
      type: "chatAttachment",
      attrs: { data_url: "data:text/plain;base64,SGVsbG8=" },
    }] }] },
  };

  assert.deepEqual(project_persisted_chat_drafts([text_record, attachment_record]), {
    "session|1:w|1:a|1:s": text_record.draft,
    "group|1:w|1:g|1:s": attachment_record.draft,
  });
});

test("忽略版本不兼容、损坏和空白草稿记录", () => {
  const invalid_records = [
    { ...create_record("session|1:w|1:a|3:old", "旧版本"), schema_version: chat_composer_schema_version + 1 },
    { ...create_record("", "缺少键") },
    { ...create_record("unknown|1:w", "未知命名空间") },
    { ...create_record("session|1:w|1:a|12:invalid-time", "时间错误"), updated_at: Number.NaN },
    { ...create_record("session|1:w|1:a|7:not-doc", "错误根节点"), draft: { type: "paragraph" } },
    { ...create_record("session|1:w|1:a|5:empty", ""), draft: { type: "doc", content: [{ type: "paragraph" }] } },
    null,
  ];

  assert.deepEqual(project_persisted_chat_drafts(invalid_records), {});
  for (const record of invalid_records) assert.equal(parse_persisted_chat_draft(record), undefined);
});

test("引用内容可以独立构成可恢复草稿", () => {
  const record = {
    ...create_record("session|1:w|1:a|9:reference", ""),
    draft: { type: "doc", content: [{ type: "paragraph", content: [{
      type: "chatReference",
      attrs: { text: "被引用的消息" },
    }] }] },
  };

  assert.equal(parse_persisted_chat_draft(record)?.session_key, "session|1:w|1:a|9:reference");
});
