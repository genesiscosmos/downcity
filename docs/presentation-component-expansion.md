# Presentation 内容组件扩展记录

## 范围

目录从 37 扩展到 74 个组件，包含对应 Item：

- 产品与概念：SnippetCard、OverviewCard、ContextCard、CompositeCard、VisualCard 五组。
- 列表与流程：EntityList、ListBlock / ListItem、Steps / StepsItem、Carousel。
- 图标：Icon、IconText、IconButton。
- 输入：DatePicker、CheckBoxGroup、RadioGroup、SwitchGroup、Chips、OptionCards 及配套项。
- 图文代码：MarkDownRenderer、CodeBlock、Image、ImageBlock、ImageGallery、ImageText、ImageTextLarge。

仍不开放 EditableTable、Modal、额外图表和远程工具执行。完整描述仍使用 schema_version=2，新增组件是目录扩展，既有内容与动作协议不变。

## 实现关系

- 组件签名与配套引用从固定版本 OpenUI 同源生成，构建时同步 openui-catalog.json。
- 模型提示补充产品、概念、紧凑事实、步骤及选项组件的用途，约束真实图片、简短标签与输入命名。
- 输入沿用 OpenUI 表单状态与现有保存/提交端口；本次不增加独立表单业务后端。
- CodeBlock 仅显示代码，不执行。
- City 消息组件新增可选 resolve_resource 展示地址解析端口。Desktop 复用 resolve_markdown_image_src，将本地绝对路径映射到 downcity-file；真实权限由现有主进程协议处理器判断。
- PresentationMedia 为媒体消费组件提供稳定包装，递归映射 src / bgImageSrc；宿主无法解析的相对地址和禁止协议返回空。接受 http(s)、内联位图和受控本地 URL，不接受脚本协议或协议相对地址。
- 图片错误通过块级提示回退，保留文字。普通媒体错误能被捕获；CSS 背景图片失败不一定触发 DOM error，因此背景图必须配有文字，不能作为唯一信息来源。
- Markdown 内嵌资源仍由上游 Markdown 渲染器处理；本地图片应使用显式 Image 系列组件以获得宿主路径解析。后续如需 Markdown 本地资源适配，应复用宿主 Markdown 组件。
- 图片包装采用 display:contents，避免破坏上游 grid/flex 布局。卡片、选项、图片和代码采用已有 Presentation 轻量边框与圆角。

## 已验证

- City 及相关依赖 no-bump 构建通过，Powers 构建通过。
- Desktop Node/Web 类型检查和生产构建通过。
- 10 项扩展与 OpenUI 关联检查通过：产品/步骤/输入描述、配套组件注册、资源协议、原发布回执及预览。
- 实际 React SSR 挂载产品概念卡片、步骤、代码与图标选项输入通过。

## 待验证

尚未在真实 Desktop Agent 对话逐项验证 DatePicker 弹层、所有输入的刷新恢复、图库预览和本地文件授权失败。SSR 与 Schema 通过不代表这些交互已经完成 GUI 验收。

可用提示：“用产品卡片比较两个虚构产品，用步骤解释选择过程，再给我一个包含日期、单选、多选和标签的偏好表单，最后展示一段示例代码；没有真实图片时使用图标，不要编造图片地址。各部分展示完成后结束回复。”

未提交、推送或发布。工作区其他改动保持不动。
