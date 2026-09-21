/**
 * Chat Composer 代码块 schema 的守卫（真实编辑器）。
 *
 * ## 为什么需要这个文件
 *
 * 前面几个测试都是纯函数：它们能证明「围栏识别对了」「序列化对了」，
 * 但证明不了**这些规则真的接在编辑器上**。历史上正是这一层出错：
 * `codeBlock: false` 让围栏 input rule 从未注册，敲 ``` 只是三个字符。
 * 这类缺陷在纯函数测试里完全看不见。
 *
 * 因此这里用 `Editor` 直接驱动真实 schema 与真实命令链（本仓库的测试不引入 DOM，
 * 因此不断言渲染结果，只断言文档结构与 `toDOM` 输出）。
 *
 * 本文件不导入 `create_chat_composer_extensions`：它引用的 `ChatComposerNodes` 是 `.tsx`，
 * Node 侧无法解析。这里按同样的配置组装 StarterKit，并显式挂上被测扩展——
 * 两处配置必须一致，`chat_composer_code_fence_config` 就是那份共同约定。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Editor, resolveExtensions, sortExtensions, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ChatComposerNewline, build_chat_composer_newline_commands } from "../src/renderer/features/chat/composer/editor/chatComposerNewline.ts";
import { ChatComposerCodeLanguage } from "../src/renderer/features/chat/composer/editor/chatComposerCodeFence.ts";

/** 与 Composer 相同的块级配置，外加被测扩展。 */
const composer_extensions = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    horizontalRule: false,
    codeBlock: { defaultLanguage: null, enableTabIndentation: false, exitOnTripleEnter: true, exitOnArrowDown: true, exitOnArrowUp: true },
  }),
  ChatComposerNewline,
  ChatComposerCodeLanguage,
];

/** 建立无 DOM 编辑器。 */
function create_editor(content: JSONContent) {
  return new Editor({ element: null, extensions: composer_extensions, content });
}

test("Composer schema 里注册了 codeBlock", () => {
  const editor = create_editor({ type: "doc", content: [{ type: "paragraph" }] });
  try {
    assert.ok(editor.schema.nodes.codeBlock, "schema 里没有 codeBlock：围栏 input rule 不会生效");
  } finally {
    editor.destroy();
  }
});

/**
 * 语言标签靠全局属性写回 DOM。
 *
 * 这条断言的是 `toDOM` 输出：语言若只留在节点属性里，用户敲的 `ts` 会在输入框里
 * 凭空消失（他们会以为没生效并重复输入）。同时确认全局属性与节点自带属性**共存**，
 * 没有把 `class="language-ts"` 挤掉。
 */
test("语言写回 <pre data-code-language>，且不挤掉节点自带的语言 class", () => {
  const editor = create_editor({ type: "doc", content: [{ type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const a = 1;" }] }] });
  try {
    const node = editor.state.doc.firstChild!;
    const dom = editor.schema.nodes.codeBlock.spec.toDOM?.(node) as [string, Record<string, unknown>, [string, Record<string, unknown>, number]];
    assert.deepEqual(dom[1], { "data-code-language": "ts" });
    assert.equal(dom[2][1].class, "language-ts");
  } finally {
    editor.destroy();
  }
});

test("无语言时不写 data-code-language，避免留下空标签", () => {
  const editor = create_editor({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "plain" }] }] });
  try {
    const node = editor.state.doc.firstChild!;
    const dom = editor.schema.nodes.codeBlock.spec.toDOM?.(node) as [string, Record<string, unknown>];
    assert.deepEqual(dom[1], {});
  } finally {
    editor.destroy();
  }
});

/**
 * 围栏动作的真实命令链：删掉围栏行 → 转成代码块。
 *
 * 必须显式 `deleteRange` 再 `setCodeBlock`：只调 `setCodeBlock` 会保留块内文本，
 * 那三个反引号与语言会留在代码的第一行。这里断言最终文档，正是为了抓住这一点。
 */
test("围栏行转代码块后，反引号与语言不残留在代码里", () => {
  const editor = create_editor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "```ts" }] }] });
  try {
    // 光标在段落末尾（doc(1) + paragraph(1) + "```ts"(5)）。
    editor.commands.setTextSelection(7);
    const { $from } = editor.state.selection;
    editor.chain().deleteRange({ from: $from.start(), to: $from.pos }).setCodeBlock({ language: "ts" }).run();

    // Tiptap 的 attrs 是 null 原型对象，因此逐项断言而不是整体 deepEqual。
    const document = editor.getJSON();
    assert.equal(document.content?.length, 1);
    const block = document.content![0]!;
    assert.equal(block.type, "codeBlock");
    assert.equal(block.attrs?.language, "ts");
    assert.equal(block.content, undefined, "围栏字符残留在代码里了：必须先 deleteRange 再 setCodeBlock");
  } finally {
    editor.destroy();
  }
});

/**
 * 代码块内 Tab 不缩进，才能移出输入框。
 *
 * 把 Tab 变成缩进会形成键盘陷阱（WCAG 2.1.2），用户只能用鼠标离开。
 * 本仓库的测试不引入 DOM，`keyboardShortcut` 需要 `KeyboardEvent`，
 * 因此断言扩展选项本身：`enableTabIndentation` 就是那个开关。
 */
test("代码块没有开启 Tab 缩进，Tab 仍能移出输入框", () => {
  const editor = create_editor({ type: "doc", content: [{ type: "codeBlock" }] });
  try {
    const code_block = editor.extensionManager.extensions.find((extension) => extension.name === "codeBlock");
    assert.ok(code_block, "schema 里没有 codeBlock 扩展");
    assert.equal(
      (code_block.options as { enableTabIndentation?: boolean }).enableTabIndentation,
      false,
      "代码块吞掉了 Tab：用户在输入框里无法用键盘离开",
    );
  } finally {
    editor.destroy();
  }
});

/**
 * Shift + Enter 在代码块内必须是块内换行。
 *
 * `chatComposerNewline` 的命令链里 `newlineInCode` 排在 `createParagraphNear` 之前，
 * 正是为了这个场景；若顺序反了，在代码块里按 Shift + Enter 会掉出代码块。
 * 这里跑的就是生产用的命令链，不是重写一遍。
 */
test("Shift + Enter 在代码块内换行，不产生新段落", () => {
  const editor = create_editor({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "const a = 1;" }] }] });
  try {
    editor.commands.setTextSelection(3);
    editor.commands.first(build_chat_composer_newline_commands);

    const document = editor.getJSON();
    assert.equal(document.content?.length, 1, "Shift + Enter 掉出了代码块");
    assert.equal(document.content?.[0]?.type, "codeBlock");
    assert.ok(document.content?.[0]?.content?.[0]?.text?.includes("\n"), "代码块内没有换行");
  } finally {
    editor.destroy();
  }
});

/** 扩展顺序：围栏语言扩展不能改变换行扩展相对 HardBreak 的优先级。 */
test("新增扩展没有改变 Shift + Enter 的插件优先级", () => {
  const plugin_order = sortExtensions([...resolveExtensions(composer_extensions)].reverse()).map((extension) => extension.name);
  assert.ok(
    plugin_order.indexOf("chatComposerNewline") < plugin_order.indexOf("hardBreak"),
    "chatComposerNewline 排到了 hardBreak 之后：Shift + Enter 又会被 setHardBreak 抢先处理",
  );
});
