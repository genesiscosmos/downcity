# Agent 与 Plugin 本地定义设计

## 1. 产品结论

- Agent 是身份、模型、主体指令和 Plugin 注册关系的拥有者。
- Agent 与 Workspace 不绑定；宿主在执行时调用 `agent.enter(workspace)`。
- Plugin 使用 `plugin.json` 声明的全局唯一 ID，不存在来源 Hash 生成的公开身份。
- Plugin 完整拥有代码与配置；框架不定义 Binding、Resource 或 Installation 持久化领域。
- CLI 与 Desktop 读取同一套用户级文件协议。

## 2. 文件结构

```text
~/.downcity/
├── agents/
│   └── <agent_id>/
│       ├── agent.json
│       └── SOUL.md
├── plugins/
│   └── <plugin_id>/
│       ├── config.toml
│       ├── plugin.json
│       ├── package.json
│       └── dist/setup.js
└── downcity.db
```

第三方 Plugin 的定义、ESM package 边界和自包含 setup 入口直接位于 `<plugin_id>/`，源码、TypeScript 配置和具体构建工具不进入安装目录；内置 Plugin 的注册由宿主注入，但配置仍使用相同的 `plugins/<plugin_id>/config.toml`。第三方 setup 模块导出 `schema` 与 `setup(context)`，内置 Plugin 由宿主直接注册。

`config.toml` 是 City 级的 Plugin 配置，不属于某个 Agent。Agent 只在自己的 `agent.json` 中保存 Plugin ID 和 profile 引用；多个 Agent 可以引用同一个 profile。Plugin 的运行时状态、缓存和私有文件由 `PluginHostContext.data_path` 提供，宿主可以按 Agent 或 Workspace 隔离。

## 3. Agent 定义

```json
{
  "schema_version": 2,
  "id": "lucas",
  "version": "1.0.0",
  "execution": { "model_id": "openai/gpt-5" },
  "plugins": {
    "skill": {},
    "chat": { "profile": "primary" }
  },
  "created_at": "...",
  "updated_at": "..."
}
```

- `SOUL.md` 是 Agent 主体指令的唯一事实源。
- Plugin 出现在 `plugins` 对象中即代表注册；移除即代表禁用。
- 配置型 Plugin 可以选择一个命名 profile；无配置 Plugin 使用空引用。
- Agent 定义不保存 Workspace ID 或路径。

## 4. Plugin Profile

```toml
schema_version = 1

[profiles.primary.queue]
max_concurrency = 4

[[profiles.primary.channels]]
id = "telegram_primary"
type = "telegram"
name = "Primary Bot"
bot_token = "123456:token"
```

TOML Profile 是原始配置值；Loader 使用 setup 模块导出的 JSON Schema 校验后再调用 setup 创建 Plugin：

```ts
const config = selected_profile ?? {};
validate_plugin_config(config, setup_module.schema);
await setup_module.setup({ plugin_id, profile: config, ...host_context });
```

账号、渠道、端点和 Token 等结构由具体 Plugin 的 setup 模块 `schema` 定义。TOML 明文保存，Plugin 目录权限为 `0700`，配置文件权限为 `0600`；宿主按 JSON Schema 的 `writeOnly` 标记脱敏。

## 5. 第三方 Plugin

一个来源目录只定义一个 Plugin，可以包含作者自己的源码和构建配置；安装协议只读取唯一的 `plugin.json`、声明 `"type": "module"` 的 `package.json` 与自包含入口：

```json
{
  "schema_version": 1,
  "id": "github",
  "version": "1.0.0",
  "description": "GitHub integration",
  "icon": "./assets/github.svg",
  "setup": "dist/setup.js"
}
```

setup 模块导出配置 Schema 与宿主装配函数：

```ts
export const schema = { type: "object", required: ["token"], properties: { token: { type: "string", writeOnly: true } }, additionalProperties: false };
export function setup(context: PluginHostContext): GithubPlugin {
  return new GithubPlugin(context.profile as GithubPluginConfig);
}
```

Plugin 代码单独声明 TypeScript 配置类型，运行时协议以 setup 模块 `schema` 为准。setup 必须是单个自包含 ESM 文件；`package.json` 负责建立明确的 ESM package 边界。安装器不导入或执行第三方 setup，也不复制源码与开发文件。

安装目标固定为 `plugins/<definition.id>/`。来源目录必须包含 `README.md`；安装器保留安装后的 `plugin.json`、`package.json`、`README.md`、自包含入口、可选本地图标与本地 `config.toml`。`config.toml` 始终保留在 Plugin 全局目录，不复制到 Agent 目录。`icon` 支持 `http(s)` URL 或 Plugin 根目录内的相对路径；本地资源必须经过路径和 symlink 校验。随机目录只用于 staging；更新原子替换整个 Plugin 目录并保留 `config.toml`。新 Schema 无法校验已有 profile 时拒绝更新；仍被 Agent 引用时拒绝卸载。

## 6. 数据库边界

`downcity.db` 只保存：

- Workspace ID、路径和展示配置。
- Agent HTTP Token。
- 平台安全设置与控制面状态。

数据库不保存 Agent 定义、Agent-Workspace 绑定、Plugin 配置、Plugin 制品或所谓 Resource。
