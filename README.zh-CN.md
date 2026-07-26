# Downcity

[![Publish packages](https://github.com/wangenius/downcity/actions/workflows/publish-packages.yml/badge.svg)](https://github.com/wangenius/downcity/actions/workflows/publish-packages.yml)
[![Publish CLI](https://github.com/wangenius/downcity/actions/workflows/publish-downcity.yml/badge.svg)](https://github.com/wangenius/downcity/actions/workflows/publish-downcity.yml)
[![npm version](https://img.shields.io/npm/v/downcity.svg)](https://www.npmjs.com/package/downcity)
[![License](https://img.shields.io/github/license/wangenius/downcity.svg)](./LICENSE)

[English](./README.md) | [简体中文](./README.zh-CN.md)

> 给 AI builders 的 Agent 基础设施，用一套可复用运行层承载多个 Agent 产品和工作流。

Downcity 给 creators、indie builders 和团队提供一套可复用的 Agent 运行基础设施，把 Agent、模型、工具、任务、记忆、插件、City、权限、usage、计费和控制台收束到同一层。你不需要为每个新的 AI 产品重复搭一遍 Agent 后端，而是可以让多个 Agent、产品和工作流复用同一套 runtime。

## 为什么是 Downcity

- 面向 AI builders：下一个 Agent 产品不应该再重复搭模型路由、工具、记忆、任务、权限、usage、计费和运维面。
- 可复用运行层：repo 或 folder 可以成为 Agent 的运行边界，Downcity 负责更完整的长期运行基础设施。
- City 能力：集中管理模型目录、运行时 env、service routing、accounts、balance、usage、payment 和 HTTP 访问。
- 可运营 Agent：支持 daemon 化运行、状态检查、历史追踪，并通过 CLI、Console、浏览器扩展或 SDK 操作。
- 可扩展架构：plugins、services、SDK API 和 UI 组件都作为明确边界对产品和团队开放。

## 仓库组成

| 包 / 目录 | 作用 |
| --- | --- |
| `downcity` | 公共 CLI 聚合包：`city`/`downcity` 是管理 Agent、运行时与控制台的本机 City 容器；`fed`/`downfed` 是 Federation Server Manager。 |
| `@downcity/agent` | 单 Agent runtime 与 SDK，负责 session、tool loop、service、plugin、HTTP/RPC、sandbox 与宿主接入。 |
| `@downcity/city` | City runtime 与访问 SDK，负责 service 注册、action、auth、env、city 访问边界与 HTTP 调用。 |
| `@downcity/type` | 跨 package 共享协议类型，包含 City 返回的 City 模型描述等核心类型。 |
| `@downcity/services` | 公共服务集合，负责 accounts、balance、usage、payment 与 Stripe 支付闭环。 |
| `@downcity/ui` | React + Tailwind UI SDK，提供 Console 与宿主应用可复用的界面组件。 |
| `templates/*` | 面向开发者的 City 快捷示例，用于组装 Node 或 Edge 运行形态；官方私有部署实现不放在这个仓库。 |
| `homepage` | 官网与面向用户的文档站点。 |

## 核心能力

- 全局 Agent 管理：Agent 身份与配置保存在 `~/.downcity/downcity.db`，每个 Agent 可绑定任意 Workspace 路径。
- 本机 Agent 运维：通过 `downcity agent start`、`downcity agent status`、`downcity agent list` 托管和查看本机 Agent。
- Agent 生命周期管理：创建、启动、停止、重启、诊断、对话、查看历史。
- City 连接：通过 `downcity federation` 让本机 Agent 连接当前 City server；模型和 Service 资源由 `city` 管理。
- City 后端能力：让多个 Agent 和产品复用 accounts、balance、usage、payment、env、auth 和 Service routing。
- 内建 Agent 能力：`chat`、`task`、`memory`、`shell`、`contact`、`skill`、`web`、`sound`、`workboard`。
- 产品表层：Downcity CLI、Agent SDK、City SDK 和 UI SDK。

## 平台支持

| 平台 | 本机 Agent 与 Safe Sandbox |
| --- | --- |
| macOS | 使用 Seatbelt，正式支持 |
| Linux | 使用 Bubblewrap，正式支持 |
| Windows 11 24H2+ | 使用 Microsoft MXC 和原生 `cmd.exe` 命令模型，Development / unstable |

Windows 原生运行通过 Microsoft MXC `processcontainer` 后端执行 `cmd.exe /d /s /c`。启动预检要求 Windows build 26100 或更高版本，并要求 MXC 成功探测到可用隔离层级；失败时不会降级为 unrestricted。MXC 当前仍是 Public Preview，Downcity 不把它声明为生产级安全边界。当前限制见 Agent SDK 的 Shell 文档。

## 快速开始

### 1. 安装 CLI

```bash
npm install -g downcity
# 或
pnpm add -g downcity
```

安装完成后会得到 `downcity` 命令（别名 `city`）：

```bash
downcity --version
```

`downcity` 是基于 `City()` 与 Agent SDK 管理和运行 Agent 的本机 City 容器。更新使用 `npm i -g downcity@latest`。同一安装包还提供 `fed`/`downfed`，用于管理 Federation Server。

### 2. 连接 Federation

```bash
downcity federation use
downcity federation status
```

`downcity` 负责模型和 Service 资源管理。`downcity federation` 负责把当前 City 连接导入本机 Agent runtime。

### 3. 创建 Agent

在目标仓库中执行：

```bash
downcity agent create .
```

初始化后会创建 Workspace 资产，但不会生成 Agent 声明文件；Agent 身份与配置保存在全局数据库：

```text
your-project/
├── .agents/
│   └── skills/
└── .downcity/
    ├── agents/
    ├── chat/
    ├── memory/
    └── task/
```

### 4. 启动 Agent

```bash
downcity agent list
downcity agent start <agent_id>
downcity agent status <agent_id>
downcity agent token create <agent_id> --name local
```

Plugin 能力统一通过 `city plugin action <plugin> <action> [agent_id]` 调用。

如果希望在当前终端前台运行：

```bash
downcity agent start --foreground
```

### 5. 查看运行中的 Agent

```bash
downcity agent list
```

常用状态命令：

```bash
downcity agent list
downcity agent status <agent_id>
```

## SDK 示例

### 本地 Agent

```ts
import { Agent, Workspace } from "@downcity/agent";
import { Shell } from "@downcity/shell";
import { MacOsSeatbeltSandbox } from "@downcity/sandbox-macos";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const agent = new Agent({
  id: "repo-helper",
  workspace: new Workspace({
    path: "/path/to/project",
    shell: new Shell({ sandbox: new MacOsSeatbeltSandbox() }),
  }),
  tools: {},
});

const session = await agent.session();
await session.set({
  model: openai.responses("gpt-5"),
});

const turn = await session.prompt({
  query: "总结一下当前仓库结构",
});
const result = await turn.finished;

console.log(result.text);
```

在 SDK 模式下，模型由宿主应用自己创建，再注入到 session。`@downcity/agent` 不负责 provider / modelId 的解析。

### 远程 Agent

```ts
import { RemoteAgent } from "@downcity/agent";

const agent = new RemoteAgent({
  baseUrl: "http://127.0.0.1:15314",
});

const session = await agent.session();
const turn = await session.prompt({
  query: "检查最近一次任务执行状态",
});
const result = await turn.finished;

console.log(result.text);
```

## 仓库结构

```text
downcity/
├── packages/
│   ├── agent/
│   ├── city/
│   ├── cli/
│   ├── services/
│   ├── type/
│   └── ui/
├── templates/
│   ├── edge/
│   └── node/
├── homepage/
├── scripts/
├── package.json
└── pnpm-workspace.yaml
```

`templates/*` 保留为开发者快捷示例，不代表官方私有生产部署实现。

## 文档入口

- 产品文档：[downcity.ai/docs](https://downcity.ai/docs)
- City SDK 文档：[downcity.ai/city-sdk-docs](https://downcity.ai/city-sdk-docs)
- Agent SDK 文档：[downcity.ai/agent-sdk-docs](https://downcity.ai/agent-sdk-docs)
- UI SDK 文档：[downcity.ai/ui-sdk-docs](https://downcity.ai/ui-sdk-docs)
- 包文档：[packages/agent/README.md](./packages/agent/README.md)、[packages/city/README.md](./packages/city/README.md)、[packages/type/README.md](./packages/type/README.md)、[packages/services/README.md](./packages/services/README.md)、[packages/cli/README.md](./packages/cli/README.md)、[packages/ui/README.md](./packages/ui/README.md)

## 本地开发

安装依赖：

```bash
pnpm install
```

构建：

```bash
pnpm build
pnpm build:agent
pnpm build:city
pnpm build:homepage
```

类型检查：

```bash
pnpm typecheck
pnpm -C packages/ui typecheck
pnpm -C homepage typecheck
```

开发模式：

```bash
pnpm dev:city
pnpm dev:agent
pnpm dev:ui-sdk
pnpm dev:homepage
```

## 运行与安全建议

- Downcity 会执行 shell、读写项目文件、启动本地 daemon，并可能通过聊天渠道接收外部消息。
- 本地 shell 与 script 命令默认经过 agent sandbox 执行：项目目录可写，网络默认开放，sandbox HOME/cache 位于 `.downcity/sandbox`。
- 建议在干净 Git 分支上使用，并通过 `git status`、`git diff` 审计改动。
- 不要把真实密钥提交到仓库；优先使用本地环境变量或 `downcity env`。
- 通过 token 和 auth 边界保护 Console、HTTP 访问和聊天渠道接入。
- `sudo`、`brew install`、Xcode 工具安装以及写系统目录这类宿主级操作不属于 sandbox 可执行边界。
