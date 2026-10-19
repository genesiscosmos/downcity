# Presentation OpenUI 迁移合同与验收记录

> 状态：OpenUI v2 核心迁移已实现，组件浏览器验收通过；真实模型流和 Desktop 会话端到端验收待完成。
> 本文取代首版 PRD 中 Presentation 的 json-render 协议、组件目录与运行时安排。通用 Power 消息、所有权、顺序和文本回退规则继续适用。

## 架构与协议

- 保留 Downcity Session、Power Action、canonical Power Part、工具来源绑定与有序投影。
- Presentation 唯一运行时切换为 OpenUI，不再保留 json-render Renderer。
- `show` 输入为 `content: string` 与 `fallback_text: string`；content 是 OpenUI Lang。
- 正式 Part 使用 schema_version=2；data 为 format=openui-lang、catalog_id=downcity.presentation.openui.v1、content。
- 旧 v1 JSON Spec 历史显示摘要，不维护两套运行时。
- 固定依赖：lang-core 1.0.1、react-lang 1.0.1、react-ui 0.18.1，均 MIT。
- 不使用 OpenUI AgentInterface、Gateway、Autofix 或独立会话存储。

## 组件与校验

`PresentationLibrary.ts` 注册布局、卡片、说明、提示、表格、图表、输入、滑块、选择器、Tabs、Accordion、指标和按钮。函数提供有界 CompoundValues 和 YearLabels。

构建时从实际 Library 生成 openui-catalog.json，包含模型说明和 JSON Schema。服务端 OpenUICatalog 只加载 lang-core 与纯 JSON，避免 React 进入 Action 服务端依赖链。

完整校验检查语法、根、未解析引用、未引用语句、属性错误、语句数量和嵌套边界。tokenizer 区分字符串与可调用名称，拒绝 Query、Mutation、Run、OpenUrl；不注入 toolProvider。描述不执行任意 JavaScript。

限制为内容 240 KiB、外壳 256 KiB、200 条语句、32 层嵌套，用户提交 16 KiB。OpenUI 的生成能力更丰富，但不能因此绕过既有资源与执行边界。

## 渐进预览

PowerRendererDefinition 增加纯 `preview(tool)`，输入为已有 Tool 快照，返回只读 Power 内容或 null。消息组件增加 preview 标记，不引入新的消息事实源。

Presentation 从 JSON 工具参数前缀中读取 action 和 content，只展示已解码且以换行闭合的语句。局部校验允许前向引用等待后续内容。生成中 Renderer isStreaming=true，宿主禁用交互、提交与成功状态保存。Action 最终仍完整校验后发布。

Desktop 首轮只对消息尾部的内置 Power 调用提供预览：存在后续 canonical 内容时降级到正常发布，不将模块挪过其他内容。预览和正式模块用来源 Tool Call 作为稳定组件及缓存身份，正式内容仍有自己的 part_id。

已知限制：

- 需要 Provider 真实输出 Tool 参数增量；未做跨 Provider 性能测量。
- 纯预览函数当前随累计输入重新解析，没有跨更新的增量编译器实例，长输入成本需真实流基准再优化。
- 任意本地插件的预览加载尚未接入消息投影；message 插槽照常支持。
- 并发内容使尾部条件失效时预览可撤回为工具活动；这是受限首轮策略，不承诺所有并发路径视觉零跳动。
- 工具失败与停止仍展示活动记录，不把半成品当成正式产物。

## 状态与样式

使用 OpenUI initialState / onStateUpdate 保存表单状态，不再以整份内容为 React key。参数更新驱动表达式与图表；@Set、@Reset 在本地执行，@ToAssistant 通过既有宿主端口提交当前状态和上下文。

状态按稳定来源定位，缓存中同时记录内容，描述变化时不应用旧缓存。仅 ready 状态保存，64 KiB 上限；整体沿用 Desktop 有界缓存。

使用 react-ui layered stylesheet，宿主层顺序为 theme、base、openui、components、utilities，并映射 Downcity 颜色令牌。上游开发模式自动挂载 Inspect 与部署提示；生产构建以 NODE_ENV 消除该 bootstrap。本轮没有依赖私有 API 修改其开发模式行为。

## 验证记录

- 已完成 Powers 构建、City 依赖构建、Desktop Node/Web 类型检查及生产构建。
- 最终 34 项关联检查通过：原位排序、成功工具去重、消息迁移、来源摘要、即时发布、新协议 Action、非法调用拒绝、不完整 JSON 参数预览和复利数值。
- 实际浏览器挂载编译后的 OpenUI Renderer 与真实样式，确认图表含坐标刻度和图例。
- 参数从 5% 调至 6%，十年本金 10000 的终值从 16288.95 更新为 17908.48。
- 筛选 Alpha 后只显示对应行；提交包含 `$rate`、`$filter` 与 action context 中的 0.06。
- 刷新与父组件重渲染保留参数；Reset 恢复默认计算和表格。
- 部分语句预览显示标题与控件轮廓，控件禁用；完整内容后启用。
- 浏览器验收为独立测试页，无真实 Agent 请求和业务执行，不等于 Desktop 真实 Session 全链路验收。

## 待验收

真实 Desktop 更新后，在启用 Presentation 的 Session 请求：先介绍复利，调用 show 输出 root 在前的 OpenUI 模块，提供可调利率、增长图、重置和解释按钮，随后继续文字解释。

检查 Tool 输入生成期间是否逐步呈现、正式完成后是否仅一份界面、停止是否恢复可读状态、提交是否进入正确 Session，以及窄屏、明暗主题、多模块和本地 Renderer 回退。

所有包仅执行 no-bump 验证；未提交、推送或发布。准备提交时按实际公开 API 影响运行 patch 脚本。
