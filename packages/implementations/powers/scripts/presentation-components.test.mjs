/** 验证新增内容目录、真实解析与图片协议边界，避免只注册名称却无法使用。 */
import assert from "node:assert/strict";
import test from "node:test";
import { PRESENTATION_LIBRARY } from "../bin/presentation/renderer/PresentationLibrary.js";
import { parse_presentation_content } from "../bin/presentation/OpenUICatalog.js";
import { resolve_presentation_resource } from "../bin/presentation/renderer/PresentationMedia.js";

const examples = {
  products: `root = Stack([products, facts, options])
products = CompositeCardBlock([CompositeCardItem("a", Text("text", "Spark"), [Text("text", "记录灵感")]), CompositeCardItem("b", Text("text", "Flow"), [Text("text", "团队协作")])])
facts = EntityList([{left: "用途", right: "比较产品"}], "small")
options = OptionCards("product", "single", [OptionCard("a", "Spark", "个人", Icon("lightbulb")), OptionCard("b", "Flow", "团队", Icon("users"))])`,
  process: 'root = Stack([concepts, steps, list, markdown, code])\nconcepts = ContextCardBlock([ContextCardItem("one", "目标用户", "给谁用"), ContextCardItem("two", "价值主张", "为什么选择你")])\nsteps = Steps([StepsItem("发现", "理解需求"), StepsItem("验证", "开展实验")])\nlist = ListBlock([ListItem("访谈", "收集证据"), ListItem("实验", "验证假设")])\nmarkdown = MarkDownRenderer("**关键结论**：先验证需求。")\ncode = CodeBlock("javascript", "const result = 1;")',
  inputs: `root = Stack([form])
form = Form("preferences", Buttons([Button("提交", @ToAssistant("分析我的选择"))]), [FormControl("日期", DatePicker("date")), FormControl("功能", CheckBoxGroup("features", [CheckBoxItem("检索", "查找资料", "search")])), FormControl("客群", RadioGroup("audience", [RadioItem("个人", "个人工作", "solo"), RadioItem("团队", "协同工作", "team")])), FormControl("偏好", Chips("tags", "multiple", [ChipItem("simple", "简洁"), ChipItem("fast", "快速")]))])`,
};

for (const [name, content] of Object.entries(examples)) {
  test(`扩展组件 ${name} 可通过实际目录解析`, () => {
    assert.ok(parse_presentation_content(content).root);
  });
}

test("74 个注册组件包含配套 Item，不意外开放编辑表格或 Modal", () => {
  assert.equal(Object.keys(PRESENTATION_LIBRARY.components).length, 74);
  for (const name of ["SwitchGroup", "SwitchItem", "ImageGallery", "ImageText", "VisualCardBlock", "Carousel", "IconButton", "StepsItem"]) assert.ok(PRESENTATION_LIBRARY.components[name]);
  assert.equal(PRESENTATION_LIBRARY.components.EditableTable, undefined);
  assert.equal(PRESENTATION_LIBRARY.components.Modal, undefined);
});

test("图片只加载允许的地址，本地文件通过宿主解析", () => {
  assert.equal(resolve_presentation_resource("https://example.com/a.png"), "https://example.com/a.png");
  assert.equal(resolve_presentation_resource("/workspace/a.png", () => "downcity-file://local/workspace/a.png"), "downcity-file://local/workspace/a.png");
  for (const source of ["javascript:alert(1)", "file:///etc/passwd", "//example.com/a.png", "relative.png", "data:text/html,test"]) assert.equal(resolve_presentation_resource(source), "");
});
