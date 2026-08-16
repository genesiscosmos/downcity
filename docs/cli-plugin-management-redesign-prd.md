# Agent 与 Plugin 本地定义设计

## 1. 产品结论

- Agent 是身份、模型、主体指令和 Plugin 注册关系的拥有者。
- Agent 与 Workspace 不绑定；宿主在执行时调用 `agent.enter(workspace)`。
- Plugin 使用 Manifest 声明的全局唯一 ID，不存在来源 Hash 生成的公开身份。
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
│       └── artifact/
└── downcity.db
```

`plugin.json` 与 `artifact/` 只属于第三方 Plugin。内置 Plugin 的 constructor 由宿主注入，但配置仍使用相同的 `plugins/<plugin_id>/config.toml`。

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

Profile 是传给 Plugin constructor 的唯一配置对象：

```ts
new PluginType({ config: selected_profile });
```

账号、渠道、端点和 Token 等结构由具体 Plugin 的 profile Schema 定义。TOML 明文保存，Plugin 目录权限为 `0700`，配置文件权限为 `0600`；宿主展示 `writeOnly` 字段时脱敏。

## 5. 第三方 Plugin

一个制品只定义一个 Plugin。源目录包含 v4 `downcity.plugin.json`：

```json
{
  "manifest_version": 4,
  "id": "github",
  "version": "1.0.0",
  "description": "GitHub integration",
  "entry": "dist/index.js",
  "config": { "schema": {} }
}
```

ESM 入口命名导出唯一 constructor：

```ts
export const plugin = GithubPlugin;
```

安装目标固定为 `plugins/<manifest.id>/`。随机目录只用于 staging；更新原子替换 `plugin.json` 和 `artifact/`，保留 `config.toml`。新 Schema 无法校验已有 profile 时拒绝更新；仍被 Agent 引用时拒绝卸载。

## 6. 数据库边界

`downcity.db` 只保存：

- Workspace ID、路径和展示配置。
- Agent HTTP Token。
- 平台安全设置与控制面状态。

数据库不保存 Agent 定义、Agent-Workspace 绑定、Plugin 配置、Plugin 制品或所谓 Resource。
