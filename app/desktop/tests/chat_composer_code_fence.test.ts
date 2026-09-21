/**
 * Chat Composer 围栏代码块的守卫。
 *
 * ## 为什么需要这个文件
 *
 * 代码块曾经在 Composer 里完全不可用，而且坏在三个不显眼的地方：
 *
 * 1. schema 里 `codeBlock: false`，围栏 input rule 永远不触发；
 * 2. 序列化按**普通段落**处理，把代码里的 `*`、`_`、`$` 全转义成反斜杠形式，
 *    并在每行之间插入空行——模型收到的不是代码；
 * 3. 反向恢复把 code token 降级成「带 code mark 的段落」，编辑历史消息时
 *    代码块静默变成行内码，语言丢失，再发送就永久损坏。
 *
 * 三处都不会抛错，只会安静地改变内容。本文件把它们钉住：
 * 断言**真实的投影结果**而不是源码字符串，因为「转义了没有」「围栏多长」
 * 只有跑一遍才看得出来。
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { JSONContent } from "@tiptap/core";
import { project_chat_composer } from "../src/common/chat/chatComposerProjection.ts";
import {
  parse_fenced_paste,
  read_chat_composer_code_fence,
  read_chat_composer_code_language,
  serialize_chat_composer_code_block,
} from "../src/common/chat/chatComposerCodeFence.ts";

/** 构造一份含代码块的 Composer 文档。 */
function code_document(language: string, code: string): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "看这段代码：" }] },
      { type: "codeBlock", attrs: { language }, content: [{ type: "text", text: code }] },
      { type: "paragraph", content: [{ type: "text", text: "结束" }] },
    ],
  };
}

test("代码块序列化成围栏，内容一个字符都不转义", () => {
  const code = "SELECT * FROM t WHERE a = 1;\nconst s = `x ${a} * 2`;\npath = C:\\tmp | a~b\n- not a list";
  const parts = project_chat_composer(code_document("sql", code));

  assert.deepEqual(parts, [{
    type: "text",
    text: `看这段代码：\n\n\`\`\`sql\n${code}\n\`\`\`\n\n结束`,
  }]);
});

test("代码本身含围栏时，外层围栏自动加长", () => {
  const code = "```\ninner\n```";
  const parts = project_chat_composer(code_document("markdown", code));
  assert.equal(parts[0]?.type === "text" && parts[0].text, `看这段代码：\n\n\`\`\`\`markdown\n${code}\n\`\`\`\`\n\n结束`);
});

test("围栏语言只保留合法字符，空语言不写进围栏", () => {
  assert.equal(read_chat_composer_code_language({ language: "TS" }), "ts");
  assert.equal(read_chat_composer_code_language({ language: "c++" }), "c++");
  // 注入式语言标记不能进入围栏文本。
  assert.equal(read_chat_composer_code_language({ language: "ts\n```\n恶意" }), "ts");
  assert.equal(read_chat_composer_code_language({ language: "" }), "");
  assert.equal(read_chat_composer_code_language(undefined), "");

  const parts = project_chat_composer(code_document("", "const a = 1;"));
  assert.equal(parts[0]?.type === "text" && parts[0].text, "看这段代码：\n\n```\nconst a = 1;\n```\n\n结束");
});

test("空代码块不构成内容，也不会把消息变成空正文", () => {
  const parts = project_chat_composer({ type: "doc", content: [{ type: "codeBlock", attrs: { language: "ts" } }] });
  assert.deepEqual(parts, []);
  // 语言属性不构成内容：`ts` 两个字不能把空代码块变成可发送的消息。
  const with_paragraph = project_chat_composer({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "说明" }] }, { type: "codeBlock", attrs: { language: "ts" } }],
  });
  assert.deepEqual(with_paragraph, [{ type: "text", text: "说明" }]);
});

test("围栏识别只认整行，段落里混着别的内容时不算", () => {
  assert.deepEqual(read_chat_composer_code_fence("```ts"), { language: "ts" });
  assert.deepEqual(read_chat_composer_code_fence("```"), { language: "" });
  assert.deepEqual(read_chat_composer_code_fence("~~~PY"), { language: "py" });
  assert.deepEqual(read_chat_composer_code_fence("  ```js  "), { language: "js" });
  assert.equal(read_chat_composer_code_fence("请看 ```"), undefined);
  assert.equal(read_chat_composer_code_fence("``"), undefined);
  assert.equal(read_chat_composer_code_fence(""), undefined);
});

test("粘贴识别只接管成对围栏，半截围栏交回默认行为", () => {
  assert.deepEqual(parse_fenced_paste("说明\n```ts\nconst a = 1;\n```\n尾注"), [
    { type: "paragraph", content: [{ type: "text", text: "说明" }] },
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const a = 1;" }] },
    { type: "paragraph", content: [{ type: "text", text: "尾注" }] },
  ]);
  // 未闭合：无法判断在哪结束，不能假装切得开。
  assert.equal(parse_fenced_paste("说明\n```ts\nconst a = 1;"), undefined);
  // 没有围栏：不接管，避免把普通多行文本重新解释一遍。
  assert.equal(parse_fenced_paste("第一行\n第二行"), undefined);
  // 空围栏不产生节点，也不算「处理过围栏」。
  assert.equal(parse_fenced_paste("```\n```"), undefined);
});

test("围栏内的空行属于代码，不会被当成块边界", () => {
  const nodes = parse_fenced_paste("```\n第一行\n\n第二行\n```");
  assert.deepEqual(nodes, [
    { type: "codeBlock", attrs: { language: "" }, content: [{ type: "text", text: "第一行\n\n第二行" }] },
  ]);
});

test("序列化与粘贴识别互为逆运算", () => {
  const code = "const a = 1;\n\nconst b = 2;";
  const serialized = serialize_chat_composer_code_block("ts", code);
  assert.deepEqual(parse_fenced_paste(serialized), [
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: code }] },
  ]);
});
