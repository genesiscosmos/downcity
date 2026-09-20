/**
 * Chat Composer 的 Shift + Enter 换行契约测试。
 *
 * ## 为什么需要这个文件
 *
 * StarterKit 的 `HardBreak` 把 `Shift-Enter` 绑成 `setHardBreak`，插的是**段内硬换行**。
 * Composer 的段落用空行分隔，段内换行会让正文块结构与用户预期不一致：用户按 Shift + Enter
 * 想要的是「正常换行」，即与回车一致的新段落。
 *
 * 这里锁两件事：
 *
 * 1. 该扩展必须在 `HardBreak` **之前**被 ProseMirror 命中，否则绑定形同不存在；
 * 2. 命令链在普通段落与列表项内都产生新块，而不是 `hardBreak` 节点。
 *
 * 断言真实文档结果，而不是只查源码字符串：按键优先级和命令链的可达性只有跑一遍才会暴露
 * （例如把 `splitBlock` 换成 `setHardBreak` 仍然「看起来」正确）。本仓库的测试不引入 DOM，
 * 因此这里用 `Editor` 直接驱动真实命令链。
 *
 * 本文件不导入 `create_chat_composer_extensions`：它引用的 `ChatComposerNodes` 是 `.tsx`，
 * Node 侧无法解析。这里按同样的配置组装 StarterKit，并显式挂上被测扩展。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Editor, resolveExtensions, sortExtensions, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ChatComposerNewline, build_chat_composer_newline_commands } from "../src/renderer/features/chat/composer/editor/chatComposerNewline.ts";

/** 与 Composer 相同的块级配置，外加被测扩展。 */
const composer_extensions = [
  StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
  ChatComposerNewline,
];

/** 建立无 DOM 编辑器。 */
function create_editor(content: JSONContent) {
  return new Editor({ element: null, extensions: composer_extensions, content });
}

/** 执行真实的 Shift + Enter 命令链，返回执行后的文档。 */
function run_newline(content: JSONContent, cursor: number): JSONContent {
  const editor = create_editor(content);
  try {
    editor.commands.setTextSelection(cursor);
    editor.commands.first(build_chat_composer_newline_commands);
    return editor.getJSON();
  } finally {
    editor.destroy();
  }
}

test("换行扩展优先于 HardBreak 的 Shift-Enter 绑定", () => {
  // ProseMirror 的 keymap 按插件注册顺序命中，Tiptap 按 priority 降序排列扩展。
  // 必须先 resolveExtensions：StarterKit 的子扩展（含 HardBreak）是它自己声明的，不展开就看不到。
  const resolved = resolveExtensions(composer_extensions);
  const plugin_order = sortExtensions([...resolved].reverse()).map((extension) => extension.name);
  const newline_index = plugin_order.indexOf("chatComposerNewline");
  const hard_break_index = plugin_order.indexOf("hardBreak");

  assert.ok(newline_index >= 0, "Composer schema 里没有注册 chatComposerNewline");
  assert.ok(hard_break_index >= 0, "Composer schema 里没有 hardBreak：假设前提已变，需要重新评估");
  assert.ok(
    newline_index < hard_break_index,
    "chatComposerNewline 排在 hardBreak 之后：Shift + Enter 仍会被 setHardBreak 抢先处理",
  );
});

test("Shift + Enter 在普通段落内产生新段落", () => {
  // doc(1) + paragraph(1) + "第一行"(3)：光标落在文本末尾。
  const document = run_newline(
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "第一行" }] }] },
    5,
  );

  assert.deepEqual(document, {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "第一行" }] },
      { type: "paragraph" },
    ],
  });
});

test("Shift + Enter 在列表项内切分列表项，与回车行为一致", () => {
  // 列表项的换行由 splitListItem 负责；若先走 splitBlock，会在列表项内部再切出段落。
  const content: JSONContent = {
    type: "doc",
    content: [{
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第一项" }] }] }],
    }],
  };
  // doc(1) + bulletList(1) + listItem(1) + paragraph(1) + "第一项"(3)。
  const document = run_newline(content, 7);

  assert.deepEqual(document, {
    type: "doc",
    content: [{
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第一项" }] }] },
        { type: "listItem", content: [{ type: "paragraph" }] },
      ],
    }],
  });
});

test("Shift + Enter 不产生段内硬换行节点", () => {
  const document = run_newline(
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "第一行" }] }] },
    5,
  );

  assert.ok(
    !JSON.stringify(document).includes("hardBreak"),
    "Shift + Enter 仍然插入了 hardBreak：这正是要修掉的块内换行",
  );
});
