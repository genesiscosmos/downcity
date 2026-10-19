/** OpenUI 迁移的关键验证：同源目录、能力边界、真实 Action 与不完整输入预览。 */
import assert from "node:assert/strict";
import test from "node:test";
import { parse_presentation_content } from "../bin/presentation/OpenUICatalog.js";
import { PresentationPower } from "../bin/presentation/Power.js";
import { preview_presentation_tool } from "../bin/presentation/renderer/PresentationPreview.js";
import { COMPOUND_VALUES } from "../bin/presentation/Functions.js";

const content = 'root = Stack([header, chart, ask])\nheader = CardHeader("Growth")\nchart = LineChart(["2024", "2025"], [Series("Revenue", [10, 20])])\nask = Button("Explain", @ToAssistant("Explain current results"))\n';

test("OpenUI 描述按真实目录校验，发布 v2 且回执不重复包含全文", async () => {
  const result = await new PresentationPower().actions.show.execute({ input: { content, fallback_text: "Revenue 10 to 20" } });
  assert.equal(result.success, true);
  assert.equal(result.data.published, true);
  assert.equal(result.data.summary, "Revenue 10 to 20");
  assert.match(result.data.next_step, /finish with a brief text response/);
  const part = result.messages[0].parts[0];
  assert.equal(part.schema_version, 2);
  assert.equal(part.data.format, "openui-lang");
  assert.equal(part.data.content, content);
  assert.equal(JSON.stringify(result.data).includes("LineChart"), false);
  assert.equal(parse_presentation_content(content).meta.errors.length, 0);
});

test("禁止远程调用、未知组件、未完成描述；字符串中的同名词不误判", () => {
  for (const bad of ['root = Query("secret", {})', 'root = Button("Go", @OpenUrl("https://example.com"))', 'root = Unknown("bad")', 'root = Stack([missing])']) assert.throws(() => parse_presentation_content(bad));
  assert.doesNotThrow(() => parse_presentation_content('root = Stack([text])\ntext = TextContent("Query() is text")'));
});

test("真实 JSON 工具参数的截断前缀产生只读预览，错误或非生成工具不产生预览", () => {
  const input = JSON.stringify({ action: "show", args: { content, fallback_text: "summary" } });
  const prefix = input.slice(0, input.indexOf("chart ="));
  const tool = { tool_name: "presentation", state: "input-streaming", input_text: prefix };
  const preview = preview_presentation_tool(tool);
  assert.ok(preview);
  assert.equal(preview.schema_version, 2);
  assert.match(preview.data.content, /CardHeader/);
  assert.equal(preview.data.content.includes("LineChart"), false);
  assert.equal(preview_presentation_tool({ ...tool, state: "failed" }), null);
  assert.equal(preview_presentation_tool({ ...tool, tool_name: "other" }), null);
  assert.equal(preview_presentation_tool({ ...tool, input_text: '{"action":"show","args":{"content":"root = Query(\\"secret\\", {})\\n' }), null);
});

test("发布回执不强制终止：不同模块可以依次发布，失败后可修正", async () => {
  const action = new PresentationPower().actions.show;
  await assert.rejects(async () => action.execute({ input: { content: 'root = Stack([missing])', fallback_text: '未完成' } }));
  for (const title of ['产品', '对比', '概念']) {
    const result = await action.execute({ input: { content: `root = Stack([heading])\nheading = CardHeader("${title}")`, fallback_text: title } });
    assert.equal(result.success, true);
    assert.equal(result.data.summary, title);
    assert.equal(result.messages.length, 1);
    assert.match(result.data.next_step, /distinct remaining content/);
  }
});

test("领域复利函数保留正确数值并限定采样规模", () => {
  const values = COMPOUND_VALUES.fn({ principal: 10000, annual_rate: 0.05, years: 10 });
  assert.equal(values.length, 11);
  assert.ok(Math.abs(values[10] - 16288.94626777442) < 1e-6);
});
