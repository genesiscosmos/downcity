/**
 * 用户气泡折叠的守卫。
 *
 * ## 为什么这个文件与上一版完全不同
 *
 * 上一版用「渲染后数行盒」来判断是否超过 10 行。它依赖布局，实测结果是**折叠不生效**：
 * 数行要等布局、要跟着宽度变化重量，而正文里混着代码块（行高不同）与段落外边距时
 * 「行」的定义本身就不唯一。
 *
 * 现在改成按**字符数**判断、按**完整 Markdown 块**截断。判断与截断都在
 * `lib/user_message_preview.ts` 里，是不依赖 DOM 的纯函数，所以本文件可以直接
 * 对算法断言——不再靠匹配源码文本来「猜」行为。
 *
 * ## 三条底线
 *
 * 1. **阈值为 2:1**（超过 400 字折叠、折叠态显示 200 字）。若两者相等，
 *    「401 字折成 400 字」除了多一次点击什么也没省下。
 * 2. **截断必须取完整块**：直接切字符串会切在 `**加粗` 或 ```` ``` ```` 围栏中间，
 *    后者会让后半屏都被渲染成代码。
 * 3. **切块不能切进代码围栏**：围栏内允许空行，按空行切会把一个围栏切成两半，
 *    每一半都是未闭合的。
 *
 * 最后一条是最容易写错、也最难在界面里看出来的：它的症状是「偶尔某条消息的折叠
 * 预览突然变成一大块代码」，而不是报错。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  build_user_message_preview,
  split_complete_blocks,
  user_message_collapse_over_chars,
  user_message_preview_chars,
  user_message_parts_text,
} from "../src/renderer/features/chat/lib/user_message_preview.ts";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const messages_root = path.join(renderer_root, "features/chat/components/messages");
const body_source = fs.readFileSync(path.join(messages_root, "UserMessageBody.tsx"), "utf8");
const session_source = fs.readFileSync(path.join(messages_root, "UserMessage.tsx"), "utf8");
const group_source = fs.readFileSync(path.join(renderer_root, "features/group/GroupView.tsx"), "utf8");

/** 造一段长度可控的正文。 */
function filler(length: number): string {
  return "字".repeat(length);
}

// ---------------------------------------------------------------------------
// 1. 阈值
// ---------------------------------------------------------------------------

test("阈值是 400 字折叠、200 字预览，且保持 2:1", () => {
  assert.equal(user_message_preview_chars, 200, "预览字数是明确的产品要求");
  assert.equal(user_message_collapse_over_chars, 400, "折叠阈值取预览的两倍");
  assert.ok(
    user_message_collapse_over_chars >= user_message_preview_chars * 1.5,
    `阈值（${user_message_collapse_over_chars}）与预览（${user_message_preview_chars}）太近：`
      + "「刚过阈值就折叠」除了多一次点击，什么也没省下",
  );
});

test("不超过阈值就不折叠", () => {
  assert.equal(build_user_message_preview(filler(400)), null, "刚好 400 字不该折叠");
  assert.equal(build_user_message_preview(filler(399)), null);
  assert.equal(build_user_message_preview(""), null, "空消息不该折叠");
  assert.ok(build_user_message_preview(filler(401)), "401 字应当折叠");
});

// ---------------------------------------------------------------------------
// 2. 截断取完整块
// ---------------------------------------------------------------------------

test("多段落：只取完整块，且不带回被切掉的段落", () => {
  const paragraph = filler(150);
  const text = [paragraph, paragraph, paragraph, paragraph].join("\n\n");
  const preview = build_user_message_preview(text);
  assert.ok(preview, "四段共 600 字应当折叠");
  // 第一段 150 字已接近预算，第二段加上就超了 200 → 只取第一段。
  assert.ok(preview.text.startsWith(paragraph), "预览没有从第一段开始");
  assert.ok(!preview.text.includes(paragraph + "\n\n" + paragraph), "预览取了超出预算的额外段落");
  assert.ok(preview.text.trimEnd().endsWith("…"), "预览没有省略号，看不出被截断");
  assert.equal(preview.plain, false, "按块截断时应当可以安全地按 Markdown 渲染");
});

test("第一个块就超预算时退化为纯文本，且长度受控", () => {
  const preview = build_user_message_preview(filler(1200));
  assert.ok(preview, "1200 字的单段应当折叠");
  assert.equal(preview.plain, true, "硬切出来的内容必须标成纯文本，否则可能按 Markdown 渲染出坏结构");
  // 允许省略号与行边界回收带来的少量偏差。
  assert.ok(preview.text.length <= user_message_preview_chars + 4, `纯文本预览过长：${preview.text.length}`);
});

test("短段落优先完整呈现，不把预算浪费在半个块上", () => {
  const small = filler(80);
  const text = [small, small, small, small, small, small].join("\n\n");
  const preview = build_user_message_preview(text);
  assert.ok(preview);
  // 预算 200，每段 80 + 空行 2 → 两段（164）放得下，三段（246）超预算。
  const paragraphs = preview.text.split("\n\n").filter((block) => block !== "…");
  assert.equal(paragraphs.length, 2, `应当正好取两段，实际 ${paragraphs.length} 段`);
});

// ---------------------------------------------------------------------------
// 3. 切块不切进代码围栏
// ---------------------------------------------------------------------------

test("围栏内的空行不是块边界", () => {
  const fenced = ["```ts", "const a = 1;", "", "const b = 2;", "```"].join("\n");
  const blocks = split_complete_blocks(fenced);
  assert.deepEqual(blocks, [fenced], "围栏被空行切开了：每一半都是未闭合的围栏");
});

test("围栏外的空行照常切块", () => {
  const text = ["第一段", "", "```ts", "const a = 1;", "```", "", "第二段"].join("\n");
  assert.deepEqual(split_complete_blocks(text), ["第一段", "```ts\nconst a = 1;\n```", "第二段"]);
});

test("未闭合的围栏让其后内容归入同一块", () => {
  // 切不开就不该假装切得开：无法判断围栏在哪结束。
  const text = ["```ts", "const a = 1;", "", "const b = 2;"].join("\n");
  assert.deepEqual(split_complete_blocks(text), [text]);
});

test("波浪号围栏同样被识别，且四种围栏字符不会互相闭合", () => {
  const tilde = ["~~~md", "内容", "", "更多", "~~~"].join("\n");
  assert.deepEqual(split_complete_blocks(tilde), [tilde], "波浪号围栏未被识别");
  const mixed = ["```ts", "const a = 1;", "~~~", "", "仍在反引号围栏内", "```"].join("\n");
  assert.deepEqual(split_complete_blocks(mixed), [mixed], "波浪号错误地闭合了反引号围栏");
});

test("长代码块的折叠预览不会截断围栏", () => {
  const code = ["```ts", ...Array.from({ length: 40 }, (_, index) => `const value_${index} = ${index};`), "```"].join("\n");
  const text = ["说明：下面是一段长代码。", "", code].join("\n\n");
  const preview = build_user_message_preview(text);
  assert.ok(preview, "应当折叠");
  assert.equal(preview.plain, false, "整块可用的情形不该退化为纯文本");
  // 取到的内容里，围栏必须成对（要么没有，要么两个）。
  const fences = preview.text.match(/^\s*```/gm) ?? [];
  assert.notEqual(fences.length, 1, "预览里出现了未闭合的围栏：后半屏会被渲染成代码");
});

// ---------------------------------------------------------------------------
// 4. 部件取文本 + 组件约束
// ---------------------------------------------------------------------------

test("按部件取文本时忽略附件与引用，且保持段落关系", () => {
  const parts = [
    { part_id: "a", type: "text" as const, text: "第一段" },
    { part_id: "b", type: "text" as const, text: "第二段" },
  ];
  assert.equal(user_message_parts_text(parts), "第一段\n\n第二段");
  // 附件不参与字符预算：它们很短，也不属于「阅读长度」。
  const with_file = [...parts, { part_id: "c", type: "file" as const, url: "x", filename: "a.png" }];
  assert.equal(user_message_parts_text(with_file as never), "第一段\n\n第二段");
});

test("组件不再做任何布局测量", () => {
  // 上一版的失效根因：靠布局数行。这里确保它不会悄悄回来。
  for (const forbidden of ["getClientRects", "ResizeObserver", "scrollHeight", "getComputedStyle", "createTreeWalker", "useLayoutEffect"]) {
    assert.ok(!body_source.includes(forbidden), `UserMessageBody 又出现了布局测量「${forbidden}」：折叠判断必须是内容自身的属性`);
  }
});

test("折叠开关常显，且默认是收起态", () => {
  const button = /<button[\s\S]*?className=\{user_message_collapse_button_class_name\}[\s\S]*?<\/button>/.exec(body_source);
  assert.ok(button, "找不到折叠开关，或它没有使用共享的按钮类名");
  assert.ok(/aria-expanded=\{expanded\}/.test(button[0]), "折叠开关没有表达展开状态");
  // 默认收起：长消息一进来就该是折起来的，否则这个功能没有意义。
  assert.ok(/useState\(false\)/.test(body_source), "初始状态不是收起态");
  assert.ok(!/opacity-0|group-hover/.test(body_source), "折叠开关带 hover 才出现的写法，收起的消息会看不出还有内容");
});

test("Session 与 Group 两个表面都接入了折叠", () => {
  assert.ok(session_source.includes("build_user_message_preview"), "Session 的用户消息没有做折叠判断");
  assert.ok(session_source.includes("preview={preview}"), "Session 没有把预览传给折叠容器");
  assert.ok(group_source.includes("build_user_message_preview"), "Group 的用户发言没有做折叠判断");
  assert.ok(group_source.includes("preview={user_preview}"), "Group 没有把预览传给折叠容器");
  // 编辑态走编辑器，不进折叠容器。
  const branch = /editing\s*\?[\s\S]{0,400}?\n\s*:\s*<UserMessageBody/.exec(session_source);
  assert.ok(branch, "编辑态与展示态的分支结构变了：期望「editing ? <UserMessageRewriteEditor …/> : <UserMessageBody…>」");
});
