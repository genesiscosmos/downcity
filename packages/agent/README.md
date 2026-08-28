# @downcity/agent

`@downcity/agent` 是 Downcity 的 Agent runtime 包。`Agent` 是主体，`City` 是承载多个 Agent、Workspace、Embassy 与 transport 的环境容器。

它负责把一个 agent 项目目录装配成可执行运行时，包括：

- 本地 SDK：`Agent`、`Group`、`Workspace`、`Session`、`RemoteAgent`
- 内部执行内核：Session Composer、LLM/Tool Loop、增量输出
- Plugin 框架：registry、action、tool runtime 与执行生命周期
- 远程访问：`RemoteAgent`、HTTP/RPC transport

CLI 与 Desktop 负责读取产品配置并显式装配 `Agent`，再通过 `city.agents.add(agent)` 将 Agent 加入环境。City 不创建 Agent，也不持有 Plugin 实例；City 只提供底层资源和 Storage，Plugin 通过执行 Context 使用被允许的能力。

## 包定位

- 面向单个 Agent 项目的执行面
- 对外通过 `@downcity/agent` 根入口暴露公共 API
- 负责 session SDK、executor 内核、plugin runtime、sandbox、SDK 本地 Agent
- 不负责多 Agent registry、control plane daemon、console UI 聚合和平台级编排

## 与其他包的边界

- `@downcity/agent`
  - Agent 与 City runtime
  - session SDK、executor 内核、plugin 框架、sandbox
  - City Workspace、Embassy、HTTP/RPC transport
- `downcity`
  - CLI City daemon 与平台控制面
- `@downcity/local`
  - CLI 与 Desktop 共用的本地数据库 Adapter、配置 Repository 与 Plugin Loader
  - 不创建 Agent、Workspace、Model 或 City
- `@downcity/ui`
  - React UI 组件与展示层

Session ID 由 `agent.sessions.create()` 内部生成；创建接口不接受调用方指定的
`session_id`。恢复已有 Session 时使用 `agent.sessions.get(session_id)`，如果该
Session 创建时绑定了 Workspace，恢复时必须传入同一个 Workspace。

Group 是和 Agent 并列的可联系主体。Group 持有自己的模型，默认通过 AI 调度器识别消息意图、选择成员和生成当前最佳响应图；没有模型或模型调用失败时，GroupSession 会记录明确的调度失败，不会静默使用另一套规则。需要自定义行为时可显式提供 `dispatch_strategy`。普通群聊消息是否投递给一个或多个成员完全由 Group.model 决定。AI 调度使用一次强制的内部 `dispatch_group` tool call，不依赖 `generateObject`；tool call 只提交 `steps` 和 `next`，SDK 再编译为内部执行图。

`steps` 是二维数组：外层阶段按顺序执行，同一阶段数组内的成员并行执行；同一个成员可以出现在不同阶段，表示它在拓扑中再次参与。例如 `[["architect"], ["developer"], ["architect"], ["reviewer"]]` 表示 architect 的回复先交给 developer，再交回 architect，最后交给 reviewer。空数组配合 `next: "stop"` 表示本次不投递成员。
并通过 `group.sessions.create()` 创建独立的群聊上下文。消息和传播属于 GroupSession；
成员执行仍通过成员 Agent 的 `AgentSessions` 完成。`prompt()` 立即返回消息回执并异步启动 user dispatch；GroupSession 只运行一个全局 auto dispatch，在当前成员执行完成后统一决定是否扩展响应图。成员运行态可通过
`subscribe()` 统一订阅共享消息和 Group/成员运行态；Session metadata 会记录 Group 与
GroupSession 来源。调度检查点也会写入 City Storage；进程中断后只依据已落盘消息继续
auto dispatch，不会重复提交已经接受的 Agent Turn。`group.sessions.list()` 返回轻量摘要，
`group.sessions.get(id)` 恢复完整上下文。

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
├── group/                 # Group 主体、GroupSession 和消息调度策略
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
  - `store/` 负责 AgentStorage、Session 和 JSONL Message 的本地持久化
  - `WorkspaceEnv.ts` 负责 Workspace 环境变量装配
  - `tool/WorkspaceTools.ts` 组合文件、搜索与可选 Shell 工具
  - `WorkspacePaths.ts` 负责 AgentStorage 私有数据路径布局

- `src/session/`
  - `Session.ts` 是公开 facade 与 Session 对象装配入口
  - `SessionState.ts` 管理配置与 metadata
  - `SessionLoop.ts` 管理输入队列和 Turn 生命周期
  - `SessionMessages.ts` 是 canonical Message 唯一事实源
  - `DefaultSessionComposer.ts` 负责 system/history/tools 与压缩计划定制
  - `messages/` 放 Assistant writer、Message codec 与 compaction；JSONL Store 位于 `workspace/store/`
  - Session 由 `AgentSessions` 统一持有；Workspace 只作为 `agent.sessions.create/get({ workspace })` 的单次执行输入

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
入口协议 -> Agent facade -> SessionLoop -> SessionComposer -> Executor -> SessionMessages
```

其中：

- `agent` 承载本地 Agent 核心运行时，`remote` 承载独立的远程 SDK 客户端
- `workspace` 承载项目资源、初始化和持久化能力，`platform` 只处理系统级路径
- `Agent` facade 是实例级装配中心，持有 instruction、model、tools、plugins 与 sessions；env 由 Workspace 持有
- `PluginContext` 只在 Agent 内部向 Plugin 投影稳定能力，不向宿主暴露
- `session / executor / plugin` 是三大核心分层
- `SessionMessages` 是 Message 唯一事实源，Executor 不持有 Store
- `types / utils` 提供横向公共支撑

持久化规则：加入 City 后，AgentSession 使用 `agents/<agent_id>/sessions/<session_id>/`，
GroupSession 使用 `groups/<group_id>/sessions/<group_session_id>/`；未加入 City 时两者均使用
当前主体实例的内存 Storage。只有传入 Workspace 的 AgentSession 或 GroupSession 才会在
`meta.json` 写入 `workspace_id`。
