/**
 * Presentation Markdown 桥接的纯映射测试。
 *
 * 只断言「哪个组件要把哪段文字、按哪个档位交给宿主」，不挂载 DOM：本仓库的测试不引入
 * 浏览器环境，渲染结果由 Desktop 侧的验收覆盖。这里盯住的是最容易静默出错的部分——
 * 文本字段取错、档位漏映射、把 OpenUI 语句引用当成 Markdown 解析。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resolve_markdown_request, resolve_step_details } from "../bin/presentation/renderer/PresentationMarkdown.js";
import { PRESENTATION_LIBRARY } from "../bin/presentation/renderer/PresentationLibrary.js";

test("MarkDownRenderer 交给宿主，并透传容器表面", () => {
  assert.deepEqual(resolve_markdown_request("MarkDownRenderer", { textMarkdown: "**要点**" }), {
    text: "**要点**", size: "body", heavy: false, variant: "clear", streaming: false,
  });
  assert.equal(resolve_markdown_request("MarkDownRenderer", { textMarkdown: "x", variant: "sunk" })?.variant, "sunk");
  assert.equal(resolve_markdown_request("MarkDownRenderer", { textMarkdown: "x", variant: "card" })?.variant, "card");
  // 未知表面值不放行，退回 clear，避免把任意字符串透给宿主。
  assert.equal(resolve_markdown_request("MarkDownRenderer", { textMarkdown: "x", variant: "shadow" })?.variant, "clear");
});

test("TextContent 的档位映射到宿主语义档位，heavy 由档位名决定", () => {
  const cases = [
    ["small", "small", false],
    ["small-heavy", "small", true],
    ["default", "body", false],
    ["large", "large", false],
    ["large-heavy", "large", true],
  ];
  for (const [input, size, heavy] of cases) {
    const request = resolve_markdown_request("TextContent", { text: "文字", size: input });
    assert.equal(request?.size, size, `${input} 应映射到 ${size}`);
    assert.equal(request?.heavy, heavy, `${input} 的字重判断错误`);
  }
  // 未声明档位时按上游默认档处理。
  assert.equal(resolve_markdown_request("TextContent", { text: "文字" })?.size, "body");
});

test("Callout 只把说明交给宿主，标题留在上游", () => {
  assert.deepEqual(resolve_markdown_request("Callout", { title: "注意", description: "说明" }), {
    text: "说明", size: "body", heavy: false, variant: "clear", streaming: false,
  });
});

test("空文本与非字符串文本不产生宿主请求", () => {
  assert.equal(resolve_markdown_request("MarkDownRenderer", { textMarkdown: "   " }), null);
  assert.equal(resolve_markdown_request("TextContent", { text: "" }), null);
  // 文本位置是 OpenUI 语句引用（数组/对象）时不能当 Markdown 解析。
  assert.equal(resolve_markdown_request("MarkDownRenderer", { textMarkdown: [{ ref: "other" }] }), null);
  assert.equal(resolve_markdown_request("Callout", { description: 42 }), null);
});

test("不消费 Markdown 的组件不产生宿主请求", () => {
  for (const name of ["Separator", "Table", "Card", "Stack", "Image"]) {
    assert.equal(resolve_markdown_request(name, { text: "任意" }), null, `${name} 不应请求宿主渲染 Markdown`);
  }
});

test("Steps 逐项给出标题与详情，详情非字符串时标记为语句引用", () => {
  const steps = resolve_step_details({
    items: [
      { props: { title: "第一步", details: "详情一" } },
      { props: { title: "第二步", details: { ref: "block" } } },
      { props: { title: "第三步" } },
      // 空字符串是文本，不是语句引用：上游会把它当空 Markdown 渲染。
      { props: { title: "第四步", details: "" } },
    ],
  });
  assert.deepEqual(steps.map((step) => [step.title, step.text]), [
    ["第一步", "详情一"],
    ["第二步", null],
    ["第三步", null],
    ["第四步", ""],
  ]);
  assert.deepEqual(steps[1].raw, { ref: "block" });
  assert.deepEqual(resolve_step_details({ items: "not-an-array" }), []);
});

test("目录仍注册 Steps 与 StepsItem 配套组件，且 Markdown 相关组件齐全", () => {
  for (const name of ["MarkDownRenderer", "TextContent", "Callout", "Steps", "StepsItem", "CodeBlock"]) {
    assert.ok(PRESENTATION_LIBRARY.components[name], `目录缺少 ${name}`);
  }
  assert.equal(Object.keys(PRESENTATION_LIBRARY.components).length, 74);
});
