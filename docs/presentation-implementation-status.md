# Presentation 首版实施记录

> 状态：核心实现与组件浏览器验收通过，待真实 Desktop 会话端到端验收及发布。
> 本记录不替代 [PRD](presentation-power-prd.md)。
> 此为 json-render 首版历史记录。当前运行时已切换 OpenUI，最新范围与验证见 [OpenUI 迁移合同](presentation-openui-migration.md)。

## 已落地

- Agent 专属 Power Content / Part，外壳校验、可信 Power 归属、工具来源关联。
- Action 内容完成即写入 canonical Message，Step 收口合并已发布内容。
- SQLite v3 → v4 原子升级，恢复角色约束和索引，保留旧消息身份。
- Codec、Mutation、上下文、压缩摘要、预览、正文复制与公共 UI 文本回退。
- Power message 插槽、官方注册、本地 Renderer 安装声明与消息入口加载。
- Presentation Power / show、同源组件目录、受限 Spec 校验和固定 json-render 0.21.1。
- 参数输入、选择器、表格筛选、复利图、重置及参数提交。
- Desktop Part 错误隔离、正文常显、本地状态恢复、有界缓存和可信当前对话提交。
- 中英文 homepage 用户文档、Power readme 与渲染开发约定。

## 已执行验证

- `pnpm -C public patch:build -- --no-bump --type --agent --city --powers --no-global-install` 通过。
- Desktop Node / Web 类型检查通过；Desktop 生产构建通过。
- CLI 类型检查通过；UI package 构建通过。
- 53 项消息存储、迁移、来源投影、即时发布、执行恢复、工具门控、正文投影与 Renderer 现有检查通过。
- Presentation Action → Power Part → 实际 React SSR 验证通过。
- 实际浏览器挂载编译后的 Presentation Renderer：筛选 Alpha 后只显示一行；利率从 0.05 调至 0.055，终值从 16,288.95 变为 17,081.44；父级重渲染保留参数；刷新恢复利率与筛选；提交只包含声明的 principal、annual_rate、years；重置恢复初始值。
- 浏览器验证使用独立本地页和测试提交处理器，不连接真实 Agent 或业务数据。验证页面与浏览器 Session 已释放，临时文件已清理。
- Public / Private diff whitespace 检查通过。

## 尚未验证与限制

- 尚未在正在运行的 Desktop 真实 Agent Session 中执行自然语言请求到界面、再提交参数到 Agent 的完整流程。
- 尚未进行完整 Desktop 明暗主题、窄屏、多模块和本地第三方 Power 安装后的 GUI 验收。首版组件存在中文固定文案，后续应按实际多语言要求完善。
- 视图缓存为最多 100 个实例、整体 2 MiB 的本地淘汰缓存；消息删除后可能保留缓存直到淘汰，不保存业务事实。
- 首版完整 Spec 校验后发布，不支持逐组件流式生成、任意业务动作、跨设备视图同步、diagram 或 MCP Apps。
- 当前 CLI 完整构建脚本依赖不存在的 `public/packages/fedman` 路径，阻断 CLI 打包。未扩大修改该独立构建问题；CLI 类型检查通过。
- 依赖最初在 Public 子 Workspace 安装后出现双依赖类型问题，已在根 Workspace 同步恢复；本地安装应遵循根 AGENTS 的单 Workspace 约定。
- 使用 no-bump 验证；未提交、推送或发布。准备提交时应按实际公开能力影响范围运行版本脚本。

## 正文顺序修正

- 按用户确认改为单一有序流，移除消息级顶部过程折叠；工具、推理与 Action 在各自原位活动块内折叠。
- 文字、Power、附件、文件改动和错误均按 canonical sequence 展示，不再按内容类型移至顶部或末尾。
- 流式文字由自身 Part 状态决定，模块保留稳定 part_id，后续块追加不改变已有前缀。
- Presentation 模型提示明确要求在对应说明位置调用 show，随后继续解释。
- Desktop 类型检查与生产构建通过，Powers 及依赖构建通过。更新后的消息检查共 32 项，其中 31 项通过；唯一失败为仓库 HEAD 中已存在的 UserMessage 布局常量守卫，本次没有改动 UserMessage。
- 此轮顺序修正尚未在真实 Desktop GUI 重新验收；原组件交互的浏览器验证不等于本轮整条消息 GUI 验证。

## 后续验收建议

启动更新后的 Desktop，在启用 Presentation 的 Agent Session 请求“用可调节年利率的图表解释复利，并提供解释当前参数的按钮”。确认正文常显、历史恢复、复制摘要，以及提交后用户消息包含来源与参数。随后验证一个仅声明 message 的本地 Power，在缺失 Renderer 和异常版本时检查回退。
