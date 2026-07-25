# @downcity/agent

`@downcity/agent` 是 Downcity 的单 Agent 运行时包。

它负责把一个 agent 项目目录装配成可执行运行时，包括：

- 本地 SDK：`Agent`、`Session`、`RemoteAgent`
- 内部执行内核：Session Composer、LLM/Tool Loop、增量输出
- Plugin 框架：registry、action、tool bridge 与执行生命周期
- 远程访问：`RemoteAgent`、HTTP/RPC transport

`downcity` 负责多 Agent 管理、控制面网关、平台 CLI、共享模型目录接入与 daemon 进程管理；`@downcity/agent` 只负责单 Agent 的执行面。

## 包定位

- 面向单个 Agent 项目的执行面
- 对外通过 `@downcity/agent` 根入口暴露公共 API
- 负责 session SDK、executor 内核、plugin runtime、sandbox、SDK 本地 Agent
- 不负责多 Agent registry、control plane daemon、console UI 聚合和平台级编排

## 与其他包的边界

- `@downcity/agent`
  - 单 Agent runtime
  - session SDK、executor 内核、plugin 框架、sandbox
  - 本地 SDK facade
- `downcity`
  - 多 Agent registry
  - control plane / gateway
  - 平台 CLI、共享模型目录接入、模型运行时绑定、全局 env、channel account store
  - agent daemon 进程管理
- `@downcity/ui`
  - React UI 组件与展示层

## 根目录结构

```text
packages/agent
├── bin/                # 构建输出目录
├── scripts/            # 构建辅助脚本
├── src/                # 源码目录
├── package.json        # 包信息、导出面、脚本
├── README.md           # 包结构说明
└── tsconfig.json       # TypeScript 配置
```

## 当前源码结构

```text
src/
├── index.ts               # 包公开入口
├── agent/                 # Agent facade、状态、模型、环境与执行绑定
├── executor/              # LLM/Tool Loop、执行恢复与内存上下文折叠
├── plugin/                # Plugin registry、执行视图、工具桥接与生命周期
├── remote/                # RemoteAgent、RemoteSession 与 HTTP/RPC transport
├── session/               # Session facade、State、Turn、Queue、Messages 与 Composer
├── types/                 # agent / executor / session / plugin 等共享协议类型
├── utils/                 # 日志、资源和通用辅助能力
└── workspace/             # 项目文件、工具、初始化、路径与结构化存储
```

## 顶层目录职责

- `src/agent/`
  - SDK facade 层
  - `Agent.ts` 负责本地 Agent 实例装配
  - `AgentSessions.ts` 负责 Session 集合生命周期
  - `ExecutionBinding.ts` 负责 Agent 执行目标绑定

- `src/workspace/`
  - 统一承载项目根目录、文件系统、模型工具、初始化和结构化存储
  - `setup/` 负责项目 `.env`、`.gitignore` 与 `.downcity` 初始化
  - `store/` 负责 Agent、Session 和 JSONL Message 的本地持久化
  - `WorkspaceEnv.ts` 负责 Workspace 环境变量装配
  - `tool/WorkspaceTools.ts` 组合文件、搜索与可选 Shell 工具
  - `WorkspacePaths.ts` 负责 Workspace 内部路径布局

- `src/session/`
  - `Session.ts` 是公开 facade 与 Session 对象装配入口
  - `SessionState.ts` 管理配置与 metadata
  - `SessionTurn.ts` 管理输入队列和 Turn 生命周期
  - `SessionMessages.ts` 是 canonical Message 唯一事实源
  - `DefaultSessionComposer.ts` 负责 system/history/tools 与压缩计划定制
  - `messages/` 放 Assistant writer、Message codec 与 compaction；JSONL Store 位于 `workspace/store/`
  - 完整设计见 [`docs/session-runtime-architecture.md`](../../docs/session-runtime-architecture.md)

- `src/executor/`
  - 内部执行内核
  - `Executor` 只负责单轮 LLM/Tool Loop、Step 状态和上下文恢复
  - 不持有 History Store，不负责 Message 或 metadata 持久化

- `src/plugin/`
  - Agent 侧 Plugin registry、执行视图、生命周期与工具桥接
  - 具体内建 Plugin 实现位于 `@downcity/plugins`

- `src/remote/transports/` 放 HTTP、RPC transport 及其内部客户端；RPC Server 与 HTTP gateway 由上游宿主管理
- Agent 与 Session 都持有宿主传入的 `AgentModel` 实例；`AgentModel` 可以是 AI SDK `LanguageModel` 或 City 返回的 `CityModel`
- Session 可通过 `session.set({ model })` 覆盖，执行时固定按 Session 模型、Agent 模型的顺序解析，并在 LLM 调用边界转换为 `LanguageModel`

- `src/types/`
  - 跨模块、跨包共享协议类型
  - `common/` 放 JSON、模板等无领域依赖的基础类型
  - `config/` 放 LLM、execution binding、plugin 配置、start options 等宿主配置契约
  - `runtime/` 放 auth、agent、host、platform 等运行时与控制面共享协议
  - 领域内部类型仍保留在对应领域目录，例如 `plugin/types/`、`executor/types/`

- `src/utils/`
  - 包内通用工具、日志、CLI 输出与存储辅助

## 模块核心与依赖方向

`@downcity/agent` 的核心是一条单 Agent 执行链：

```text
入口协议 -> Agent facade -> SessionTurn -> SessionComposer -> Executor -> SessionMessages
```

其中：

- `agent` 承载本地 Agent 核心运行时，`remote` 承载独立的远程 SDK 客户端
- `workspace` 承载项目资源、初始化和持久化能力，`platform` 只处理系统级路径
- `Agent` facade 是实例级装配中心，持有 instruction、model、tools、plugins 与 sessions；env 由 Workspace 持有
- `PluginContext` 只在 Agent 内部向 Plugin 投影稳定能力，不向宿主暴露
- `session / executor / plugin` 是三大核心分层
- `SessionMessages` 是 Message 唯一事实源，Executor 不持有 Store
- `types / utils` 提供横向公共支撑

完整架构、执行链、持久化、Plugin、Shell 与跨平台设计见
[`docs/agent-sdk-architecture.md`](../../docs/agent-sdk-architecture.md)。
