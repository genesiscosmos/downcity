# Downcity

[![npm version](https://img.shields.io/npm/v/downcity.svg)](https://www.npmjs.com/package/downcity)
[![License](https://img.shields.io/github/license/genesiscosmos/downcity.svg)](./LICENSE)

[English](./README.md) | [简体中文](./README.zh-CN.md)

> 用于构建和运行 Agent 产品与工作流的基础设施。

Downcity 为 Agent、模型、工具、任务、记忆和权限提供一套可复用的运行时。在一个 City 中托管多个 Agent，为每个 Session 指定项目 Workspace，并通过 Downtown 连接模型与服务。

## 为什么是 Downcity

- 多个 Agent、产品和工作流复用同一套运行时。
- Agent 身份、项目 Workspace 与 Session 历史各自独立管理。
- 模型与服务有明确的来源身份，每条连接独立登录。
- 通过 City 托管 Agent，通过 CLI、SDK 或自定义界面交互。
- 通过 Power、服务、Workspace 实现和可复用 UI 组件扩展应用。

## 仓库组成

| 包 / 目录 | 作用 |
| --- | --- |
| `downcity` | CLI 聚合包：`downcity` / `city` 管理本机 Agent、Workspace 和 City 宿主；`downtown` 管理 Downtown 服务端。 |
| `@downcity/city` | City 组装、Agent 注册、Town 连接、Workspace/Shell 资源、Power、存储、RemoteAgent 和 HTTP/RPC 传输。 |
| `@downcity/agent` | Agent 与 Group 执行、Session、模型/工具循环及宿主扩展接口。 |
| `@downcity/downtown` | Downtown 服务端与 SDK，提供模型、服务、鉴权和用户/管理员访问。源码位于 `packages/downtown`。 |
| `@downcity/type` | 模型、Workspace、Shell、Session 与宿主集成的共享协议。 |
| `@downcity/powers` | 任务、记忆、技能、网页、消息和界面呈现等可复用能力。 |
| `@downcity/services` | 账户、额度、用量、组织、反馈与支付服务。 |
| `@downcity/sandbox-native` | Workspace Shell 使用的操作系统原生 Sandbox 实现。 |
| `@downcity/ui` | Console 与宿主应用可复用的 React + Tailwind 组件。 |
| `templates/*` | Agent、本地/边缘 Downtown 和 React UI 入门示例。 |

## 核心能力

- 在用户级 Downcity 数据目录中独立管理 Agent 身份与已登记的 Workspace。
- 通过 `downcity on`、`downcity status`、`downcity off` 管理 CLI City 宿主，Agent 共享宿主生命周期。
- 通过 CLI 或 SDK 创建 Session、发送消息和查看历史。
- 通过 `downcity towns` 管理独立的 Downtown 连接，发现模型与服务。
- 将 Workspace 的文件/Shell 工具与内建、自定义 Power 组合使用。
- 通过 `city power install` 安装预构建包或本地/Git 代码来源，统一使用 `list`、`inspect`、`config`、`reload`、`update`、`uninstall` 和 `action` 管理。操作使用稳定 `power_id`，统一列表显示安装形态、来源和实际状态。代码来源还可提供 Agent 定义、模型及 Downtown 连接，详见 [Power 管理](https://downcity.ai/zh/docs/cli/powers)。

## 平台支持

CLI 为本地 Workspace 的 Shell 命令使用 `NativeSandboxProvider`。

| 平台 | 默认本地 Shell Sandbox |
| --- | --- |
| macOS | 通过 `/usr/bin/sandbox-exec` 使用 Seatbelt |
| Linux | 通过 `/usr/bin/bwrap` 使用 Bubblewrap；需要安装 bubblewrap 并启用用户命名空间 |
| Windows | Native Provider 暂不支持 |

原生 Sandbox 使用项目的真实绝对路径。文件访问遵循 Workspace、运行目录和工具链策略，网络默认开放。Shell 执行前会检查隔离是否可用，不可用时执行失败。宿主执行需要明确审批。

## 快速开始

### 1. 安装 CLI

```bash
npm install -g downcity
# 或
pnpm add -g downcity
```

请先安装 Node.js 和 npm（或 pnpm）。安装包提供 `downcity`（别名 `city`）和 Downtown 服务端管理命令 `downtown`（别名 `town`）。`town` 与 `downtown` 共用入口，`town deploy` 等价于 `downtown deploy`：

```bash
downcity --version
```

通过 `npm install -g downcity@latest` 更新。使用 `downtown --help` 查看服务端管理命令，使用 `downcity --help` 查看本机 City 命令。

### 2. 连接模型与服务

你需要一个可访问的 Downtown 服务端，且账户有可用模型。将示例 URL 替换成你的服务地址：

```bash
downcity towns add https://your-downtown.example.com --name primary
downcity towns list
```

使用同一个服务端 URL 登录。登录通过交互完成，仅作用于该连接：

```bash
downcity towns login https://your-downtown.example.com
downcity towns models
downcity towns services
```

### 3. 登记 Workspace 并创建 Agent

在项目目录执行，将 `MODEL_ID` 替换成 `downcity towns models` 返回的完整 `model_id`：

```bash
downcity workspace register .
downcity agent create --id repo-helper --name "Repo Helper" --model MODEL_ID
downcity agent list
```

Workspace 登记保存项目路径。Agent 创建在用户级 Downcity 数据目录（默认 `~/.downcity`）中保存独立身份和模型选择。更换模型使用 `downcity agent update repo-helper --model MODEL_ID`。

### 4. 启动 City 并发送消息

```bash
downcity on
downcity status
downcity agent chat repo-helper --workspace-path . --message "总结一下当前仓库结构"
```

省略 `--message` 可进入交互式对话。聊天与 Session 执行需要正在运行的 CLI 或 Desktop City 宿主。无宿主时仍可使用配置与历史查看命令。

使用 `downcity on --foreground` 可在当前终端前台运行，使用 `downcity off` 停止 CLI 宿主。

### 5. 授权 SDK 访问（可选）

```bash
downcity token create --name local-sdk --agents repo-helper
```

命令会交互询问有效期等剩余配置。签发时请保存 Bearer Token，明文只显示一次。默认 HTTP Agent URL 为 `http://127.0.0.1:5314/agents/repo-helper`；如已修改 HTTP 地址或端口，请使用实际配置。`15314` 是独立的本机 RPC 端口。

## SDK 示例

### 本地 Agent

在 Node.js ESM/TypeScript 应用中安装 `@downcity/city`、`@downcity/downtown` 和 `@downcity/sandbox-native`。设置 `OPENAI_API_KEY`，选择服务商支持的模型，并将下面的两个绝对路径替换成项目目录和可写的运行目录。此独立 SDK 示例自行提供模型，无需启动 CLI City 宿主。

```ts
import { Agent, Shell, Workspace } from "@downcity/city";
import { create_openai_compatible_model } from "@downcity/downtown";
import { NativeSandboxProvider } from "@downcity/sandbox-native";

const api_key = process.env.OPENAI_API_KEY;
if (!api_key) throw new Error("Set OPENAI_API_KEY before running this example");

const model = create_openai_compatible_model({
  id: "gpt-5",
  upstream_model: "gpt-5",
  base_url: "https://api.openai.com/v1",
  api_key,
});

const workspace = new Workspace({
  id: "project",
  path: "/path/to/project",
  shell: new Shell({
    sandbox_provider: new NativeSandboxProvider(),
  }),
  runtime_path: "/path/to/downcity-runtime/project",
});
const agent = new Agent({ id: "sdk-repo-helper", model, workspace });

try {
  const session = await agent.sessions.create();
  const turn = await session.prompt({
    query: "总结一下当前仓库结构",
  });
  const result = await turn.finished;
  if (!result.success) throw new Error(result.error || "Agent turn failed");
  console.log(result.text);
} finally {
  try {
    await agent.dispose();
  } finally {
    await workspace.dispose();
  }
}
```

在 SDK 模式下，模型由宿主应用创建，再作为 Agent 默认模型或 Session 覆盖模型传入。`@downcity/agent` 不负责解析服务商或模型 ID。

### 远程 Agent

安装 `@downcity/city`。将 `DOWNCITY_AGENT_URL` 设置为快速开始中的完整 HTTP Agent URL，将 `DOWNCITY_TOKEN` 设置为有权访问该 Agent 的 City Token。City 必须正在运行，Agent 必须有可用模型。此示例创建的 Session 不包含项目上下文。

```ts
import { RemoteAgent } from "@downcity/city";

const agent_url = process.env.DOWNCITY_AGENT_URL;
const city_token = process.env.DOWNCITY_TOKEN;
if (!agent_url || !city_token) {
  throw new Error("Set DOWNCITY_AGENT_URL and DOWNCITY_TOKEN");
}

const agent = new RemoteAgent({ url: agent_url, token: city_token });

try {
  const session = await agent.sessions.create();
  const turn = await session.prompt({ query: "你好，你能帮助我做什么？" });
  const result = await turn.finished;
  if (!result.success) throw new Error(result.error || "Agent turn failed");
  console.log(result.text);
} finally {
  await agent.close();
}
```

## 仓库结构

```text
downcity/
├── packages/
│   ├── agent/
│   ├── city/
│   ├── cli/
│   ├── downtown/             # @downcity/downtown
│   ├── implementations/
│   │   ├── databases/
│   │   ├── powers/
│   │   ├── sandboxes/
│   │   ├── services/
│   │   └── workspaces/
│   ├── type/
│   └── ui/
├── templates/
│   ├── agent/
│   ├── edgefed/
│   ├── localfed/
│   └── ui/
├── scripts/
├── package.json
└── pnpm-workspace.yaml
```

`templates/*` 提供开发者入门示例和演示项目。`ui` 模板是独立的 React + Vite 应用，用于预览公共 `@downcity/ui` 组件。

## 文档入口

- 产品文档：[downcity.ai/docs](https://downcity.ai/docs)
- City SDK 文档：[downcity.ai/city-sdk-docs](https://downcity.ai/city-sdk-docs)
- Agent SDK 文档：[downcity.ai/agent-sdk-docs](https://downcity.ai/agent-sdk-docs)
- UI SDK 文档：[downcity.ai/ui-sdk-docs](https://downcity.ai/ui-sdk-docs)
- 包文档：[Agent](./packages/agent/README.md)、[City](./packages/city/README.md)、[Downtown](./packages/downtown/README.md)、[Types](./packages/type/README.md)、[Services](./packages/implementations/services/README.md)、[CLI](./packages/cli/README.md)、[UI](./packages/ui/README.md)

## 本地开发

独立克隆本公开仓库时，使用 Node.js 和 `package.json` 声明的 pnpm `10.22.0`，在仓库根目录安装依赖：

```bash
pnpm install
```

若本仓库位于完整 Downcity 工作区的 `public/` 目录中，请在父级工作区根目录安装依赖。下面的公开脚本在 `public/` 中执行。

构建全部包，不修改版本号，也不将 CLI 安装到全局：

```bash
pnpm build -- --no-global-install
```

单独构建 SDK 包：

```bash
pnpm build:agent
pnpm build:city
```

类型检查：

```bash
pnpm typecheck
pnpm -C packages/ui typecheck
```

开发入口（按需选择）：

```bash
pnpm dev:cli
pnpm dev:agent
pnpm dev:powers
pnpm dev:ui-sdk
pnpm dev:ui-template
```

## 运行与安全建议

- Downcity 会执行 shell、读写项目文件、启动本地 daemon，并可能通过聊天渠道接收外部消息。
- 本地 Workspace 的 shell 与 script 命令默认经过原生 Sandbox 执行。项目目录可写，命令会修改真实文件；授权额外路径前请检查当前 Sandbox 策略。
- 建议在干净 Git 分支上使用，并通过 `git status`、`git diff` 审计改动。
- 不要把真实密钥提交到仓库；优先使用本地环境变量或 `downcity env`。
- 通过 token 和 auth 边界保护 Console、HTTP 访问和聊天渠道接入。
- 宿主级安装和系统配置需要通过明确审批的宿主操作执行。
