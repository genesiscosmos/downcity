# CLI Plugin 管理与动态安装重设计

> 状态：已实施
>
> 更新时间：2026-07-28

## 1. 产品意图

City Plugin 管理解决两个问题：

- 用户如何从可信来源安装一个可执行 Plugin 制品。
- 一个 Agent 如何启用并配置全局可用 Plugin。

Plugin 的运行时能力仍由 `@downcity/agent` 定义。安装来源、配置表单、全局制品目录和 Agent Binding 属于 CLI/City 控制面，不进入 Agent SDK。

## 2. 目标模型

```text
静态 Plugin Manifest / 内建 Plugin 定义
  → Plugin Catalog
  → Agent Plugin Binding（enabled + config）
  → Plugin Factory
  → Agent Runtime Plugin
```

单一事实源：

- Plugin Catalog 持有全局可用制品的统一视图。
- Agent Plugin Binding 持有 Agent 的启用状态和完整配置。
- 内建 Chat Plugin 的 Zod Schema 是 Chat 配置协议源码。
- 外部 Plugin 的静态 JSON Schema 是安装制品配置协议。

## 3. 配置协议

外部 Plugin 仓库必须提交：

```text
plugin-repository/
├── downcity.plugin.json
└── dist/
    ├── index.js
    └── config.schema.json
```

Manifest 示例：

```json
{
  "manifest_version": 1,
  "name": "example",
  "version": "1.0.0",
  "entry": "dist/index.js",
  "config": {
    "schema": "dist/config.schema.json",
    "defaults": {}
  }
}
```

安装器只读取静态 JSON。Plugin 作者可以在源码中使用 Zod，并在构建时通过 `z.toJSONSchema()` 生成 Schema 文件；CLI 使用 Ajv 按 JSON Schema 2020-12 校验安装默认值和 Agent Binding。

`x_downcity` 是静态 UI 注解。动态选项只能引用 CLI 注册的可信资源 Provider，Manifest 不能声明或注入回调代码。

## 4. Chat 配置迁移

Chat 不再拥有 CLI 专用配置入口。其配置通过普通 Plugin Binding 保存，并由通用 Schema 表单编辑。

canonical 字段统一为：

- `channel_account_id`
- `max_concurrency`
- `merge_debounce_ms`
- `merge_max_wait_ms`

Store 启动时一次性把旧加密 Binding 转换为新字段；运行时只读取新协议，不保留双字段兼容。

## 5. 安装与信任边界

支持来源：

- 本地目录。
- HTTPS、SSH Git URL，可带 `#branch` 或 `#tag`。
- `github:owner/repository#ref` shorthand。

安装过程：

1. 复制本地目录或 shallow clone Git 来源。
2. 读取 Manifest 和 JSON Schema。
3. 拒绝路径逃逸和符号链接。
4. 校验默认配置和构建后 ESM entry。
5. 计算全部静态文件的 SHA-256 完整性摘要。
6. 原子替换全局安装目录并保存 commit、来源和 Manifest 快照。

安装过程不执行 `npm install`、`postinstall`、构建脚本或 Plugin entry。Plugin 必须提交自包含 ESM 制品。Plugin 在 Agent 启动后运行于 Agent 进程，因此 TUI 安装前必须提示用户确认来源可信。

## 6. 生效检查点

Binding 修改只写入全局数据库。运行中的 Agent 不热替换 Plugin；用户需要显式重启 Agent，让下一次 Runtime 装配在清晰检查点读取完整 Binding 快照。

## 7. 明确不做

- 不把安装 Factory 放进 `@downcity/agent`。
- 不执行第三方仓库依赖安装或构建脚本。
- 不提供运行中 Plugin 热更新。
- 不在本阶段建设在线 Plugin 商店或第三方 Plugin 进程隔离。
