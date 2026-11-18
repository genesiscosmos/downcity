# @downcity/ui

`@downcity/ui` 是 Downcity 的 React UI 组件包。

它提供基础 UI 原语、统一 Markdown 阅读组件、聊天输入与消息、模型配置、会话状态面板、样式入口，以及 workboard 相关复合组件。
这个包只负责界面组件和类型，不负责 Agent 或 City 的运行时逻辑。

## 包定位

- 面向 React 宿主应用的组件库。
- 提供基础组件和少量复合业务组件。
- 提供样式入口，供外部项目按需引入。

## 与其他包的边界

- `@downcity/ui`
  - 只负责 UI 组件、样式和组件类型。
- `@downcity/agent`
  - 负责 Agent 运行时，不依赖这个包做执行。
- `downcity`
  - 可能消费这个包的组件，但平台逻辑不在这里。

## 根目录结构

```text
packages/ui
├── dist/               # 构建输出目录
├── src/                # 源码目录
├── package.json        # 包信息、导出面、构建脚本
├── README.md           # 包文档
└── tsconfig.json       # TypeScript 配置
```

## 源码结构树

```text
src
├── index.ts
├── source.css
├── styles.css
├── components/
├── lib/
└── types/
```

## 目录职责

- `src/index.ts`
  - 对外导出入口。
  - 统一导出组件、工具函数和组件类型。

- `src/source.css`
  - 原始样式资源入口。
  - 适合需要直接消费源码样式的场景。

- `src/styles.css`
  - 对外公开的样式入口。
  - 宿主应用按需引入这个文件来启用组件样式。

- `src/components/`
  - 组件实现目录。
  - 基础原语组件：
    - `button`、`card`、`input`、`label`、`checkbox`
    - `dialog`、`dropdown-menu`、`context-menu`、`popover`、`sheet`
    - `command`、`item`、`empty`、`spinner`、`kbd`、`code-block`
    - `tabs`、`toggle`、`toggle-group`
    - `select`、`slider`、`switch`、`settings`
    - `tooltip`、`separator`、`skeleton`、`sonner`
  - 业务复合组件：
    - `chat.tsx`
    - `workboard.tsx`
    - `workboard-stage.tsx`
    - `workboard-game-*`
    - `workboard-pixel-agent.tsx`

- `src/lib/`
  - 组件内部共享工具。
  - `session-message.ts`：将 Session SDK canonical message 投影为 Chat 展示消息。

- `src/types/`
  - UI 组件和 workboard 的类型定义。
  - `components.ts`：基础组件相关类型。
  - `workboard*.ts`：workboard 及其地图/舞台/角色相关类型。

## 当前导出内容

`src/index.ts` 当前主要导出三类内容：

- 基础组件
  - `Button`、`Badge`、`Card`、`Dialog`、`Input`、`Label`
  - `DropdownMenu`、`ContextMenu`、`Popover`、`Sheet`、`Command`
  - `Item`、`Empty`、`Spinner`、`Kbd`、`CodeBlock`
  - `Tabs`、`Toggle`、`ToggleGroup`
  - `Select`、`Slider`、`Switch`
  - `SettingsContainer`、`SettingSection`、`SettingGroup`、`SettingItem`、`InfoRow`
  - `Tooltip`、`Separator`、`Skeleton`、`Toaster`

- 复合组件
  - `ChatPanel`、`ChatHistory`、`ChatMessage`、`ChatComposer`
  - `Workboard`
  - `buildWorkboardGameMapConfig`

- 类型与工具
  - `cn`
  - `session_message_to_chat_message`、`session_part_to_chat_part`
  - 按钮、卡片、toast 等基础类型
  - workboard 相关展示与地图类型

## 模型与会话状态

- `ModelSelector` 与 `ChatModelSelector` 共用目录、搜索、品牌图标与模型详情，聊天入口可按宿主能力配置推理强度。
- `ChatApprovalModeSelector` 使用共享 Session 审批模式；`ModelPricingChart` 与格式化函数提供一致的模型信息展示。
- `StatusPanel` 接收完整 `session_key`、队列、交互、后代会话、文案与动作；切换会话释放临时状态。队列调度、会话导航与私密提交 transport 由宿主持有。
- `MessageQueue`、`QueuedMessageResources`、`PendingInteractionArea`、`AgentInteraction`、审批/问题卡片、`SubSessionList`、`PillSwitcher` 和模型目录/详情组件均可独立使用。
- 表单和状态布局按需引入 `@downcity/ui/status-panel.css`；标准主题与 Tailwind 扫描入口仍分别为 `styles.css` 与 `source.css`。

使用说明与真实运行示例见 Homepage 的 [模型控件](https://downcity.ai/zh/ui-sdk-docs/components/model-controls)及[状态面板](https://downcity.ai/zh/ui-sdk-docs/components/status-panel)文档。

## 关键调用关系

### 1. 组件导出

```text
src/components/*
  -> src/index.ts
  -> 外部 React 应用 import
```

### 2. 样式使用

```text
宿主应用
  -> 引入 @downcity/ui/styles.css
  -> 使用组件
```

### 3. workboard 复合组件

```text
workboard 类型
  -> src/types/workboard*.ts
  -> src/components/workboard*.tsx
  -> src/index.ts 对外导出
```

## Markdown 阅读组件

```tsx
import { MarkdownView } from '@downcity/ui';
import '@downcity/ui/markdown.css';

<MarkdownView text={document_text} />
<MarkdownView text={message_text} mode="streaming" layout="embedded" />
```

宿主加载 UI 主题 token 后，再加载 Markdown 专用样式。`document` 为默认布局，正文最大宽度 `45rem`，上下 `2rem`、左右 `1.25rem` 留白；`embedded` 填满宿主且无外层留白。正文默认使用 `medium`（`0.875rem`）字号、1.65 倍行高，标题为 500 字重；标题与代码按正文的固定 `em` 比例缩放，适配整体界面缩放及浅色和深色主题。`embedded` 读取 Provider 的字号档位，`document` 与静态导出始终使用默认 `medium`。

组件封装 GFM、代码高亮与复制、公式、图片、SVG、Mermaid、HTML 清洗和超限降级。代码、表格和宽公式保留内部横向滚动。字体、字号和行高由组件统一管理，MarkdownView 不提供 `typography`、`size` 或 `style` 覆盖参数；字号只接受 Provider 的受控四档选择。`class_name` 仅用于外层布局。

SVG 无效或尚未完成时显示带内边距的等宽源码，支持键盘聚焦和独立滚动，完整保留内容。Mermaid 按正文实际字号布局，随四档字号与整体界面缩放重新布局；宽图保留原始布局尺寸并在图表内横向滚动，小图居中，保留全屏查看。渲染失败时结束加载转圈，显示错误与重试操作。

`MarkdownViewProvider` 接入可选的 `text_size: MarkdownViewTextSize`、`resolve_image_src(src, document_url)` 和 `translate(key)`；嵌套 Provider 中未提供的项分别继承上层值。默认使用 `medium`、网页图片解析与英文图表操作文本，不依赖 Desktop。

| `MarkdownViewTextSize` | 标签 | 字号 |
| --- | --- | --- |
| `small` | 小 | `0.8125rem` |
| `medium` | 标准（默认） | `0.875rem` |
| `large` | 大 | `0.9375rem` |
| `extra_large` | 特大 | `1rem` |

`@downcity/ui/markdown.css` 同时提供 `.downcity-writing-text`，供宿主输入正文共用 Markdown 的系统字体栈、400 字重、1.65 倍行高、自然字距、自动光学尺寸与抗锯齿，以及主题前景 90%／背景 10% 的文字混色。该类不设置字号、文档宽度或段落间距，不提供排版覆盖能力；宿主输入框配合 `get_markdown_text_size(text_size)` 读取受控字号。

`MarkdownViewTextSize` 与 `get_markdown_text_size` 从包入口导出；`get_markdown_text_size(text_size)` 返回 rem 字符串，供宿主 Composer 与消息正文保持一致。四档数值由 UI 包内部定义，宿主负责持久化选择并将字号 Provider 限定在聊天区域。Desktop 的独立外观设置“对话字号”在本机保存、即时更新，可一键恢复 `medium`；仅作用于 Work、Chat、Draft、Group 的用户消息、Agent 回复与输入框，按钮、导航、文件预览、任务文档及静态导出保持原字号。

独立静态导出可使用 `MarkdownExportContext.Provider value={true}`，始终按 `medium` 排版，展开代码与表格的横向滚动内容、使长内容换行、隐藏操作按钮，并让离屏图表完成渲染。导出图表按页面宽度完整缩放，SVG 回退源码展开换行；文件生成与保存由宿主负责。

## 当前最重要的入口文件

- `src/index.ts`
  - 组件和类型统一导出入口。
- `src/styles.css`
  - 公开样式入口。
- `src/components/`
  - 组件实现主体。
- `src/types/`
  - 组件公共类型定义。

## 开发与构建

```bash
npm run build
```

## 维护约定

- 这个包只放 UI 组件、样式和类型。
- 不要把 Agent runtime、City CLI、控制面逻辑写进来。
- `dist/` 是构建产物，不直接手改。
- 新组件需要同时考虑：
  - 是否应该从 `src/index.ts` 导出
  - 是否需要在 `src/types/` 中补类型
  - 是否需要宿主额外引入样式
