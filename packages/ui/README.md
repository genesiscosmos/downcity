# @downcity/ui

`@downcity/ui` 是 Downcity 的 React UI 组件包。

它提供基础 UI 原语、样式入口、以及 workboard 相关复合组件。  
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
    - `workboard.tsx`
    - `workboard-stage.tsx`
    - `workboard-game-*`
    - `workboard-pixel-agent.tsx`

- `src/lib/`
  - 组件内部共享工具。
  - 目前主要是样式类名辅助函数。

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
  - `Workboard`
  - `buildWorkboardGameMapConfig`

- 类型与工具
  - `cn`
  - 按钮、卡片、toast 等基础类型
  - workboard 相关展示与地图类型

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
