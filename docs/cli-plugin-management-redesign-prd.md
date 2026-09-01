# Agent 与 Plugin 本地定义设计

> 状态：已由 Plugin Renderer 三插槽方案取代旧的 setup/Schema 通用表单方案。

## 1. 产品结论

- Plugin 是唯一产品单元，不再引入 Extension 身份。
- Plugin 可以选择提供 `agent`、`main` 和单一 `renderer` 入口。
- Profile 只是宿主提供的命名配置隔离空间，位于某个 Plugin 下，不是 Plugin 类型。
- Plugin Sidebar + Mainview 提供不依赖 Profile 的业务工作区；Config 管理 Profile 具体内容。
- Agent 只保存 Plugin ID 与可选 Profile ID，不保存 Plugin 业务配置。
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
│       ├── README.md  # 实际路径由 plugin.json.readme 声明
│       └── dist/
│           ├── agent.js
│           ├── main.js
│           └── renderer.js
└── downcity.db
```

三类入口都是可选的，但至少提供一个。`plugin.json.readme` 必须声明 Plugin 根目录内的 `.md` 用户文档。安装器只复制清单声明的入口、`package.json`、声明的 README、可选图标，并保留本地 `config.toml`；源码和构建配置不进入安装目录。

## 3. Agent 定义

```json
{
  "schema_version": 2,
  "id": "lucas",
  "plugins": {
    "skill": {},
    "chat": { "profile": "primary" }
  }
}
```

Plugin 出现在 `plugins` 对象中表示 Agent 启用它。只有提供 `agent` 能力的 Plugin 才能启用。没有 Profile 引用时 Agent factory 获得空配置；显式引用不存在的 Profile 时装配失败。

## 4. Profile

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

Profile 是 City 级共享配置，不属于某个 Agent。多个 Agent 可以显式复用同一个 Profile。配置以明文 TOML 保存，目录权限为 `0700`、文件权限为 `0600`。

只有声明 Config 的 Plugin 才拥有 Profile。宿主只负责 Profile CRUD 与配置存储，不解释业务字段。Plugin main 的 Config action 负责读写、校验和安全投影；Config 只通过独立 gateway 编辑当前 Profile。凭据原文是否可回传、空输入是否保留旧值等规则必须由 Plugin 自己实现。

## 5. 第三方 Plugin

```json
{
  "schema_version": 1,
  "id": "github",
  "version": "1.0.0",
  "description": "GitHub integration",
  "readme": "./README.md",
  "icon": "./assets/github.svg",
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

- `agent` 默认导出 Agent Plugin factory。
- `main` 默认导出 `activate/deactivate` 生命周期对象，并注册管理 actions。
- `renderer` 默认导出成对的 Sidebar + Mainview 与/或独立 Config；实际导出必须与清单静态声明一致，宿主注入统一 UI Components 与各自 action gateway。

安装不会导入或执行 `agent/main`，不会运行依赖安装或构建脚本。入口与本地图标必须位于 Plugin 根目录内且不能使用 symlink。更新原子替换制品并保留 `config.toml`；仍被 Agent 引用的第三方 Plugin 不能卸载。

## 6. 交互路径

```text
进入 Plugins
→ Sidebar 查看完整 Plugin Catalog
→ 点击任意 Plugin 查看描述、README 与可选 Config
→ 功能型 Plugin 同时出现在一级导航条
→ 点击一级入口后，左侧切换为 Plugin Sidebar，主区域显示 Plugin Mainview
→ Agent 启用 Plugin；有 Config 时选择 Profile
```

所有 Plugin 都出现在 Catalog。没有业务工作区的 Plugin 仍可提供 Config；没有 Config 的 Plugin 只显示说明且不提供 Profile。CLI 的 `config --set` 只是显式 JSON 替换能力，不承担通用业务表单职责。

## 7. 数据库边界

`downcity.db` 保存 Workspace 索引、Agent HTTP Token 和平台控制面状态，不保存 Agent 定义、Plugin Profile、Plugin 制品或 Agent-Plugin 引用。
