# Plugin SDK、City 与 Agent 统一加载设计

> 状态：已实现。本文覆盖并取代旧的 `setup + JSON Schema + 宿主通用表单` 设计。

## 1. 设计目标

Plugin 同时支持两条简单路径：

1. SDK 用户直接创建 Plugin 实例并传给 Agent。
2. CLI、Desktop 等通用宿主通过一个 Plugin 包加载未知能力。

Plugin 是唯一身份。宿主不再增加 Extension、任意 UI contributions DSL、Binding 或 Resource 等中间概念。

## 2. Plugin 的三个可选部分

```text
Plugin
├── agent      可选：为 Agent 创建运行实例
├── main       可选：宿主管理逻辑与 actions
└── renderer   可选：Sidebar + Mainview 业务工作区和/或 Config
```

三者共享同一个 Plugin ID，但拥有不同生命周期：

- `agent` factory 每次装配一个 Agent 时调用，产生 Agent 独享实例。
- `main` 每个宿主中的每个 Plugin 只激活一次，不绑定 Profile。
- `renderer` 在用户打开 Plugin 一级功能工作区或 Catalog 详情 Config 时加载；业务工作区与配置体验互不混合。

## 3. 依赖与职责

```text
Desktop / CLI ──→ @downcity/local ──→ @downcity/agent
       │                 │
       └────────→ @downcity/plugin

Plugin agent ──→ @downcity/agent
Plugin main ───────────→ @downcity/plugin
Plugin renderer ───────→ @downcity/plugin/react + react
```

City/宿主负责安装、Profile CRUD、Agent 引用、入口加载和生命周期。Agent 内核只运行已经创建好的 Plugin 实例。Plugin 自己负责产品功能、业务配置结构、校验、安全投影和 Renderer 交互。

## 4. 清单与安装协议

```json
{
  "schema_version": 1,
  "id": "example",
  "version": "1.0.0",
  "title": "Example",
  "description": "Example integration",
  "readme": "./README.md",
  "icon": "./assets/icon.svg",
  "agent": "./dist/agent.js",
  "main": "./dist/main.js",
  "renderer": {
    "entry": "./dist/renderer.js",
    "sidebar": true,
    "mainview": true,
    "config": true
  }
}
```

至少声明一个运行入口。`agent/main` 入口和 `renderer.entry` 都使用 `.js` 或 `.mjs`。`agent/main` 是自包含 ESM；`renderer` 是单文件浏览器 ESM，静态声明是否提供 `sidebar`、`mainview`、`config`，实际默认导出必须与声明完全一致。`sidebar` 与 `mainview` 必须成对出现，`config` 可独立存在。Renderer 把 React 与 JSX runtime 映射到宿主运行地址。`package.json` 必须声明 `"type": "module"`；`readme` 必须声明 Plugin 根目录内的 `.md` 用户文档。

安装器只验证并复制声明制品，不求值第三方模块。所有路径都必须留在 Plugin 根目录内且不能经过 symlink，`readme` 声明的文件也参与完整性摘要；更新时保留现有 `config.toml`。

## 5. Agent factory

```ts
import type { AgentPluginModule, PluginHostContext } from "@downcity/agent";

const create_agent_plugin: AgentPluginModule<GithubPlugin>["default"] = (
  context: PluginHostContext,
) => new GithubPlugin(context.profile as unknown as GithubPluginConfig);

export default create_agent_plugin;
```

factory 是宿主装配适配器，不是安装脚本或 Agent Plugin 生命周期。每次调用必须返回新实例，实例 `name` 必须与 Plugin ID 一致。Plugin Class 的 constructor 完全由作者设计；SDK 用户可以绕过 factory 直接实例化。

## 6. Plugin main

```ts
import { define_plugin_main } from "@downcity/plugin";

export default define_plugin_main({
  activate({ plugin }) {
    plugin.config_action({
      id: "profile.read",
      run: async (_input, context) => context.config.get(),
    });
    plugin.config_action({
      id: "profile.save",
      run: async (input, context) => {
        const config = validate_profile(input);
        await context.config.set(config);
        return to_public_profile(config);
      },
    });
  },
});
```

main 只注册结构化 actions 并管理自己的长期资源。`plugin.action()` 服务 Sidebar/Mainview，不依赖 Profile；`plugin.config_action()` 在每次调用时注入配置，因此一个 main 可以安全服务多个 Profile。宿主只提供最小系统辅助：Agent 与 Workspace 列表、受控 Agent Plugin action 调用、受限外链、文件定位、剪贴板和结构化日志。

## 7. Renderer 与 UI 边界

Renderer 是 Plugin 唯一的前端入口。它通过 `define_plugin_renderer` 默认导出定义，并可声明三个语义固定的插槽：

- Sidebar 与 Mainview 必须一起声明，获得共享的 `navigation.route` / `navigation.navigate()` 与不依赖 Profile 的 `plugin.invoke()`；
- Config 独立声明，只在 Plugin Catalog 详情出现，并获得绑定当前 Profile 的 `config.invoke()`；
- 宿主统一提供的 `ui.components`；
- 宿主 Toast 与 Confirm。

Profile ID、Plugin ID 与 Desktop controller 不传给组件。宿主持有完整 Plugin Catalog、每个 Plugin 的详情与 Profile CRUD，并把声明 Sidebar + Mainview 的 Plugin 动态放入一级导航；Plugin 只渲染自己的 Sidebar、Mainview 与 Config 正文。

Renderer 是受信任本地 UI 代码，不使用 iframe。第三方 bundle 通过受控 `downcity-plugin://` URL 动态加载，并复用宿主 React 与 JSX runtime；源码和构建依赖不进入安装目录。组件不应依赖宿主私有 DOM 或 preload API，外链、剪贴板、文件定位和业务读写通过 main action 完成。

宿主最小 UI 集包括 `Page/Section/Group/Row`、`Stack/Inline/Toolbar/Tabs`、`Button/Input/Select/Switch`、`CodeBlock` 与统一反馈组件。需要提供类似 Chat Session 的第二层历史导航时，Renderer 使用 `MainviewSidebar/MainviewSidebarItem` 把导航内容投放到 Shell 的 Sidebar Subbar；Subbar 不属于 Mainview，由宿主统一拥有布局位置、折叠、宽度调整、偏好持久化与独立滚动。框架不使用配置 Schema 生成 UI。

## 8. Profile

Profile 只是宿主在一个 Plugin 下提供的命名配置空间：

```text
plugins/<plugin_id>/config.toml
└── profiles.<profile_id>
```

只有声明 Config 的 Plugin 才拥有 Profile。宿主统一创建、选择和删除 Profile，但不定义字段 Schema，也不生成通用配置表单。Plugin main 决定内容如何校验和持久化，Config 决定如何编辑。Agent 对有 Config 的 Plugin 记录 `plugin_id → profile_id` 引用；没有 Config 的 Plugin 只记录启用状态。多个 Agent 可以共享同一 Profile。

本地存储当前使用 TOML，因此 Profile 必须是 TOML 可表达的 JSON object，不应写入 `null` 或其他 TOML 无法表示的值。

## 9. 生命周期与错误语义

- 安装阶段不执行任何第三方入口。
- Agent 装配时才加载 `agent` 并调用 factory。
- 首次 Renderer action 调用时激活 `main`，宿主退出时调用 `deactivate`。
- Config Plugin 的 Profile 不存在时拒绝 Agent 装配或 Config action，但不阻断 Plugin 级 action。
- action 输入、输出必须可 JSON 序列化。
- renderer 未声明 Config 时，宿主不展示 Profile 管理，也不猜测配置 UI。

## 10. 非目标

- 不支持 Sidebar、Mainview 与 Config 之外的任意 contributions 插槽。
- 不支持宿主通用 Schema 表单。
- 不把业务配置写入 `agent.json`。
- 不允许 renderer 直接调用 Agent 或 Electron。
- 不要求 SDK Plugin Class 接收 Profile。
