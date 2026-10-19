# Presentation

Presentation 使用 OpenUI 在 Desktop 回复正文中生成布局、图表、表格、指标和可交互表单。模块按消息产生顺序穿插显示，成功发布后不重复显示对应成功工具活动。

## 使用

向 Agent 说“用带可调利率的图表解释复利”或“用图表和表格比较这些方案”。`presentation.show` 接收 `content`（OpenUI Lang 字符串）与 `fallback_text`（文字摘要）。参数中的 content 优先生成，第一行写 root，子组件和数据随后定义，以便逐步呈现。

```json
{
  "content": "root = Stack([header, chart, buttons])\nheader = CardHeader(\"增长比较\")\nchart = LineChart([\"2024\", \"2025\"], [Series(\"收入\", [10, 20])])\nbuttons = Buttons([Button(\"解释结果\", @ToAssistant(\"解释图表结果\"))])\n",
  "fallback_text": "收入从 2024 年的 10 增长到 2025 年的 20。"
}
```

开放 74 个组件及配套 Item，包括产品/概念卡片、列表、步骤、轮播、图标、图标按钮、Markdown、代码、图片和图库，以及布局、表格、图表和指标。输入包含日期、单选、多选、开关、Chips 和 OptionCards。实际签名由固定版本组件库自动生成并注入模型说明，不能沿用旧 JSON Spec 格式。

## 交互

`$variables` 绑定本地参数；`@Set` 更新，`@Reset` 恢复默认，`@ToAssistant` 将问题与当前表单状态提交给当前对话。交互不额外调用模型，只有用户明确提交才发起新输入。

提供 `@CompoundValues(principal, annual_rate, years)` 与 `@YearLabels(years)` 支持复利探索。利率使用小数，0.05 表示 5%；本金范围 0–10¹²，年限为 1–100 整数。滑块绑定是数字数组，计算时使用 `$rate[0]`。

Desktop 本地保存状态，按消息来源定位，不跨设备同步。旧 json-render 内容仅显示文字摘要。

## 渐进预览与限制

首轮预览仅用于消息尾部的 Presentation 调用，展示已闭合且通过局部检查的 OpenUI 语句。生成中控件禁用，Action 最终校验成功后转为可交互模块。Provider 必须实际发送 Tool 参数增量；并发内容或不支持增量的路径降级为完整发布。

图片允许真实 http(s) URL、内联位图及宿主授权的本地绝对路径；本地路径映射为受控文件协议，加载失败保留文字。相对地址必须先解析，禁止伪造图片地址。CodeBlock 只展示代码。不支持 Query、Mutation、Run、OpenUrl 和任意业务执行；EditableTable、Modal 及其余新增图表暂未开放。模块内容最多 240 KiB、200 条语句、32 层嵌套，外壳最多 256 KiB；提交参数最多 16 KiB。本地缓存受现有容量限制，超限时不保存恢复状态。

依赖固定版本 `@openuidev/lang-core` 1.0.1、`@openuidev/react-lang` 1.0.1、`@openuidev/react-ui` 0.18.1，MIT 许可：[OpenUI](https://github.com/thesysdev/openui)。不使用其 Gateway 或会话后端。
