# CLI Plugin 管理与动态安装重设计

> 状态：已实施
>
> 更新时间：2026-07-28

## 1. 产品意图

City Plugin 管理解决三个问题：

- 用户如何从可信来源安装一个可执行 Plugin 制品。
- 一个 Agent 如何启用并配置全局可用 Plugin。
- Plugin 如何声明、解析和复用完整 Resource Item。

Plugin 的运行时能力仍由 `@downcity/agent` 定义。安装来源、配置表单、全局制品目录、Plugin Resource 和 Agent Binding 属于 CLI/City 控制面，不进入 Agent SDK。

## 2. 目标模型

```text
静态 Plugin Manifest / 内建 Plugin 定义
  → Plugin Catalog
  → Plugin Resource（完整 Item）
  → Agent Plugin Binding（enabled + config + resource_ids）
  → Resource ID 解析
  → Plugin Factory
  → Agent Runtime Plugin
```

单一事实源：

- Plugin Catalog 持有全局可用制品的统一视图。
- Agent Plugin Binding 持有 Agent 的启用状态和完整配置。
- Plugin Resource Store 持有完整 Resource Item，Binding 不复制其内容。
- 内建 Chat Plugin 的 Zod Schema 是 Chat 配置与 Resource 协议源码。
- 外部 Plugin 的静态 JSON Schema 是安装制品配置协议。

## 3. 配置协议

外部 Plugin 仓库必须提交：

```text
plugin-repository/
├── downcity.plugin.json
└── dist/
    ├── index.js
    ├── config.schema.json
    └── resource.schema.json
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
  },
  "resources": {
    "schema": "dist/resource.schema.json"
  }
}
```

安装器只读取静态 JSON。Plugin 作者可以在源码中使用 Zod，并在构建时通过 `z.toJSONSchema()` 生成 Schema 文件；CLI 使用 Ajv 按 JSON Schema 2020-12 校验安装默认值、Agent Binding 和完整 Resource Item。

Resource Schema 必须要求 `id`、`type` 和 `name`。`id` 是 City 写入的 `readOnly` 字段；其他 `readOnly` 顶层字段只能由 Resource Resolver 写入；`writeOnly` 字段由通用表单安全采集并在输出时脱敏。Resolver 输出合并后必须重新通过完整 Schema 校验。

## 4. Chat 配置迁移

Chat 不再拥有 CLI 专用配置入口或账号池。queue 行为通过普通 Plugin Binding 保存，渠道凭据与动态名称作为完整 Plugin Resource Item 保存。

Binding 只保存：

- `config`
- `resource_ids`

Store 启动时一次性把旧 `channel_accounts` 转换为 `chat` Plugin Resource，并把旧 Chat Binding 引用转换为 `resource_ids`。运行时只读取新协议，不保留双协议。

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

安装过程不执行 `npm install`、`postinstall`、构建脚本或 Plugin entry。Plugin 必须提交自包含 ESM 制品。Plugin entry 会在 Resource 创建、编辑、刷新以及 Agent 启动时执行，因此 TUI 安装前必须提示用户确认来源可信。

## 6. 生效检查点

Resource 创建、编辑和刷新先得到完整候选 Item，Resolver 与 Schema 校验全部成功后才原子保存。Binding 或 Resource 修改不会热替换运行中 Plugin；下一次 Agent 装配按 ID 读取不可变 Resource Item 快照。

## 7. 明确不做

- 不把安装 Factory 放进 `@downcity/agent`。
- 不执行第三方仓库依赖安装或构建脚本。
- 不提供运行中 Plugin 热更新。
- 不在本阶段建设在线 Plugin 商店或第三方 Plugin 进程隔离。
