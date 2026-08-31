# Plugin SDK、City 与 Agent 统一加载设计

> 状态：已实现。本文覆盖并取代旧的 `setup + JSON Schema + 宿主通用表单` 设计。

## 1. 设计目标

Plugin 同时支持两条简单路径：

1. SDK 用户直接创建 Plugin 实例并传给 Agent。
2. CLI、Desktop 等通用宿主通过一个 Plugin 包加载未知能力。

Plugin 是唯一身份。宿主不再增加 Extension、多个 UI 插槽、contributions DSL、Binding 或 Resource 等中间概念。

## 2. Plugin 的三个可选部分

```text
Plugin
├── agent      可选：为 Agent 创建运行实例
├── main       可选：宿主管理逻辑与 actions
└── renderer   可选：唯一 Mainview
```

三者共享同一个 Plugin ID，但拥有不同生命周期：

- `agent` factory 每次装配一个 Agent 时调用，产生 Agent 独享实例。
- `main` 每个宿主中的每个 Plugin 只激活一次，不绑定 Profile。
- `renderer` 在用户打开某个 Plugin/Profile 时由隔离 iframe 承载。

## 3. 依赖与职责

```text
Desktop / CLI ──→ @downcity/local ──→ @downcity/agent
       │                 │
       └────────→ @downcity/plugin

Plugin agent ──→ @downcity/agent
Plugin main/renderer ──→ @downcity/plugin
```

City/宿主负责安装、Profile CRUD、Agent 引用、入口加载和生命周期。Agent 内核只运行已经创建好的 Plugin 实例。Plugin 自己负责业务配置结构、校验、安全投影和 Mainview 交互。

## 4. 清单与安装协议

```json
{
  "schema_version": 1,
  "id": "example",
  "version": "1.0.0",
  "title": "Example",
  "description": "Example integration",
  "icon": "./assets/icon.svg",
  "agent": "./dist/agent.js",
  "main": "./dist/main.js",
  "renderer": "./dist/mainview.html"
}
```

至少声明一个入口。`agent/main` 是自包含 `.js` 或 `.mjs`；`renderer` 是单个自包含 `.html`。`package.json` 必须声明 `"type": "module"`，来源必须包含 `README.md`。

安装器只验证并复制声明制品，不求值第三方模块。所有路径都必须留在 Plugin 根目录内且不能经过 symlink。安装内容参与完整性摘要；更新时保留现有 `config.toml`。

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
    plugin.action({
      id: "profile.read",
      run: async (_input, context) => context.config.get(),
    });
    plugin.action({
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

main 只注册结构化 actions 并管理自己的长期资源。Profile 在每次 action 调用时注入，因此一个 main 可以安全服务多个 Profile。宿主只提供最小系统辅助：受限外链、文件定位、剪贴板和结构化日志。

## 7. Mainview 与安全边界

Renderer 是 Plugin 唯一的前端入口。它通过 `@downcity/plugin/renderer` 的 gateway 调用 main action，消息不携带 Plugin ID 或 Profile ID；身份由宿主承载 frame 绑定。

Desktop 使用无同源权限的 sandbox iframe 和强制 CSP。Mainview 不能访问 Node、Electron、宿主 DOM、任意网络或本地文件。需要外链、剪贴板等操作时必须调用 main 的明确 action。

Renderer 必须打包成单个 HTML，包括脚本和样式，不允许依赖安装目录中的额外前端资源。

## 8. Profile

Profile 只是宿主在一个 Plugin 下提供的命名配置空间：

```text
plugins/<plugin_id>/config.toml
└── profiles.<profile_id>
```

宿主统一创建、选择和删除 Profile，但不定义字段 Schema，也不生成通用配置表单。Plugin main 决定内容如何校验和持久化，Mainview 决定如何编辑。Agent 只记录 `plugin_id → profile_id` 引用；多个 Agent 可以共享同一 Profile。

本地存储当前使用 TOML，因此 Profile 必须是 TOML 可表达的 JSON object，不应写入 `null` 或其他 TOML 无法表示的值。

## 9. 生命周期与错误语义

- 安装阶段不执行任何第三方入口。
- Agent 装配时才加载 `agent` 并调用 factory。
- 首次 Mainview action 调用时激活 `main`，宿主退出时调用 `deactivate`。
- Profile 不存在时拒绝 Agent 装配或 main action。
- action 输入、输出必须可 JSON 序列化。
- renderer 缺失时宿主仍可管理 Profile 外壳，但不猜测配置 UI。

## 10. 非目标

- 不支持多个前端插槽。
- 不支持宿主通用 Schema 表单。
- 不把业务配置写入 `agent.json`。
- 不允许 renderer 直接调用 Agent 或 Electron。
- 不要求 SDK Plugin Class 接收 Profile。
