# @downcity/agent

`@downcity/agent` 是 Downcity 的单 Agent runtime 包。`Agent` 持有身份、模型、指令、Tool 与 Session，并可独立于 City 运行。

它负责把单个 Agent 装配成可执行运行时，包括：

- 本地 SDK：`Agent`、`Group`、`Session`
- 内部执行内核：Session Composer、LLM/Tool Loop、增量输出
- 中立宿主执行端口：接收 City 提供的 Tool、SessionHooks 与 Workspace 协议

CLI 与 Desktop 通过 `@downcity/city` 读取宿主配置并显式装配 `Agent`，再将 City 级 Plugin 注册到 `City`。调用 `city.agents.add(agent)` 后，City 中全部 Plugin 自动对该 Agent 可用；Agent 不保存 Plugin 实例。Plugin 的实例、配置投影、Hook scope 与生命周期均由 City 持有。

## 包定位

- 面向单个 Agent 项目的执行面
- 对外通过 `@downcity/agent` 根入口暴露公共 API
- 负责 Session SDK、Executor 内核、中性执行端口与 SDK 本地 Agent
- 不负责多 Agent registry、control plane daemon、console UI 聚合和平台级编排

## 与其他包的边界

- `@downcity/agent`
  - Agent、Group、Session
  - Session SDK、Executor 内核和中性执行端口
- `@downcity/city`
  - City 组合根、Workspace/Embassy 装配、RemoteAgent 与 HTTP/RPC transport
  - Plugin Registry、Hook 调度、唯一实例和生命周期
  - `@downcity/city/local` 提供本地数据库、配置 Repository 与 Plugin Loader
- `@downcity/city/plugin`
  - Plugin 作者协议、Context、Action、Hook、Lifecycle 与统一 City module
- `downcity`
  - CLI City daemon 与平台控制面
- `@downcity/ui`
  - React UI 组件与展示层

Session ID 由 `agent.sessions.create()` 内部生成；创建接口不接受调用方指定的
`session_id`。Session 默认来源是 `{ type: "chat" }`，Group 使用 `group`，Task Plugin
使用 `task`，其他创建方也可以在 `create({ origin })` 中声明任意非空的 `origin.type`
及附加 JSON 元数据。恢复已有 Session 使用 `agent.sessions.get(session_id, origin_type = "chat")`；
该调用只读取指定来源分区，不跨目录猜测。如果 Session 创建时绑定了 Workspace，恢复时还必须
通过第三个参数传入同一个 Workspace，例如 `get(session_id, "task", { workspace })`。

Group 是和 Agent 并列的可联系主体。Agent 的 `name` 是可见名称，`description` 是供展示和 Group 选择成员使用的能力简介；两者不替代控制 Agent 行为的 `instruction`。Group 持有自己的模型，默认通过 AI 调度器结合 Group 目标、对话上下文和成员的 `id/name/description` 生成有限阶段计划。没有模型或模型调用失败时，GroupSession 会记录明确的调度失败，不会静默使用另一套规则。需要自定义行为时可显式提供 `dispatch_strategy`，异步策略应响应输入中的 `abort_signal`。

AI 调度在同一 Turn 内通过强制的 `dispatch_group` tool call 提交 `reason`、`stages` 和 `next`。`stages` 按顺序执行，每个阶段包含一个或多个成员专属 `assignment`，同一阶段内并行执行；同一个成员可以在不同阶段再次参与。`next: "continue"` 只表示下一步选择必须依赖当前阶段的真实输出；当前对话已满足用户意图时返回空 `stages` 和 `next: "stop"`，已知阶段执行后即可完成时也使用 `stop`。32 次上限与重复路径检测只用于异常熔断，不参与正常的停止判断。

调用 `group.sessions.create()` 可创建独立的群聊上下文。消息和传播属于 GroupSession；
成员执行仍通过成员 Agent 的 `AgentSessions` 完成。`prompt()` 立即返回消息回执并异步启动 user dispatch；GroupSession 只运行一个全局 auto dispatch，在当前成员执行完成后统一决定是否需要依据结果继续判断。成员运行态可通过
`subscribe()` 统一订阅共享消息和 Group/成员运行态；Session metadata 会记录 Group 与
GroupSession 来源。GroupSession 的调度 Turn 日志与传播检查点都会写入 City Storage；
进程中断后可以根据调度阶段重新执行尚未完成的 user dispatch 或继续 auto dispatch。
`GroupSession.stop()` 会同时中断调度模型和成员 Session。`group.sessions.list()` 返回轻量摘要，
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
├── model/                 # 模型请求与 Tool Loop 内核、消息转换与 prompt 资产
├── host/                  # Agent 宿主端口
├── internal/              # Agent 与 Group 的内部运行时装配
├── plugin/                # Agent 使用的 Plugin 执行协议辅助
├── remote/                # 远程 Agent 与 Session 客户端协议
├── session/               # Session facade、执行编排、消息与持久化
├── tools/                 # Agent 内置 Tool
├── types/                 # agent / executor / session 等包内类型
└── utils/                 # 日志、资源和通用辅助能力
```

## 顶层目录职责

- `src/agent/`
  - SDK facade 层
  - `Agent.ts` 负责本地 Agent 实例装配
  - `AgentSessions.ts` 负责 Session 集合生命周期
  - `ExecutionBinding.ts` 负责 Agent 执行目标绑定

- `src/session/`
  - `Session.ts` 是公开 facade 与 Session 对象装配入口
  - `SessionState.ts` 管理配置与 metadata
  - `SessionLoop.ts` 是 Command Queue 的唯一消费者与 Turn 生命周期所有者；Prompt Command 创建或加入 Turn，维护类 Command 在空闲期独立执行
  - `SessionComposition.ts` 提供 Compose 所需的宿主事实：system snapshot、检查点 env/hook 与只读历史
  - `runner/` 放 Session 级编排对象：`SessionExecutor`（模型请求与 Tool Loop）与 `StepInputAssembly`（每个 Step 的模型输入装配）
  - `session.db` 是 canonical Message 唯一事实源，`SessionMessages.ts` 负责领域写入、恢复和有界运行态投影
  - `DefaultSessionComposer.ts` 负责 system/history/tools，并默认使用 Part 级 checkpoint 压缩
  - `messages/` 放 Assistant 状态转换与 writer、Message codec、Tool effect 投影与结构化文件编辑 Diff
  - `composer/` 放 Composer 实现与共用组装原语；压缩算法为纯函数，checkpoint 表读写归 Composer 自己
  - `storage/` 负责 Session SQLite、附件和事务；只使用 AgentStorage，不访问项目 Workspace
  - Session 由 `AgentSessions` 统一持有；Workspace 只作为 `agent.sessions.create({ workspace })` 或 `agent.sessions.get(session_id, origin_type, { workspace })` 的单次执行输入

- `src/group/`
  - `storage/` 负责 GroupSession 的 metadata、共享消息和调度记录持久化

- `src/model/`
  - 模型协议与 Provider 请求的低层内核，不持有 History Store，也不负责 Message 或 metadata 持久化
  - `ModelStepRunner` / `ModelRequestRunner` 负责单步模型请求与重试；`ModelGenerate` 是共享的一次性生成入口
  - `messages/` 负责 Session Message 与 Model Protocol 之间的转换
  - `prompts/` 放默认 core system prompt 资产及相关生成模块
  - 模型请求与 Tool Loop 的执行编排在 `session/runner/`

- `src/plugin/`
  - 只保留 Agent 公开的 Action schedule 与 Plugin 协议辅助
  - Plugin Registry、Hook 调度与生命周期属于 `@downcity/city`

- `src/remote/transports/` 放 HTTP、RPC transport 及其内部客户端；RPC Server 与 HTTP gateway 由上游宿主管理
- Agent、Session 与 Group 统一持有宿主传入的 `ModelClient`；City 返回的 `CityModel` 在该协议上额外提供目录与展示元数据
- Session 可通过 `session.set({ model })` 覆盖，执行时固定按 Session 模型、Agent 模型的顺序解析，并直接通过统一的 `ModelClient` 协议调用

- `src/types/`
  - 跨模块、跨包共享协议类型
  - `config/` 放 LLM、execution binding、plugin 配置、start options 等宿主配置契约
  - `runtime/` 放 auth、agent、host、platform 等运行时与控制面共享协议
  - 领域内部类型仍保留在对应领域目录，例如 `plugin/types/`、`model/types/`

- `src/utils/`
  - 包内通用工具、日志、CLI 输出与存储辅助

## 模块核心与依赖方向

`@downcity/agent` 的核心是一条单 Agent 执行链：

```text
入口协议 -> Agent facade -> SessionLoop -> SessionComposer -> Executor -> SessionMessages
```

其中：

- `agent` 承载本地 Agent 核心运行时
- Workspace、Shell 与 Plugin 实现由 City 持有，Agent 只消费 `@downcity/type` 中的中立协议
- `Agent` facade 是实例级装配中心，持有 instruction、model、tools 与 sessions；env 由 Workspace 持有，Plugin 由 City 持有
- `PluginContext` 由 City 为 Agent/Workspace 执行范围创建，只向 Plugin 投影稳定的受限能力
- `session / executor` 是 Agent 的核心执行分层，Plugin 通过 `SessionHooks` 进入 Session
- `SessionMessages` 是 Message 唯一事实源，Executor 不持有 Store
- `types / utils` 提供横向公共支撑

持久化规则：加入 City 后，AgentSession 使用 `agents/<agent_id>/sessions/<origin_type>/<session_id>/`，
归档后使用 `agents/<agent_id>/archived-sessions/<origin_type>/<session_id>/`；每个 Session 目录包含
`session.db` 与 `attachments/`，`origin_type` 会被安全编码为单个目录段。普通聊天默认位于 `sessions/chat/`。
GroupSession 使用 `groups/<group_id>/sessions/<group_session_id>/`；未加入 City 时两者均使用
当前主体实例的内存 Storage。只有传入 Workspace 的 AgentSession 或 GroupSession 才会在
`session_state` 写入 `workspace_id`。GroupSession 使用 `Group.model` 根据首条用户消息异步生成并持久化
`title`，`preview_text` 仍只保存最后一条消息摘要；`rename(title)` 可提交手动标题。AgentSession 的
状态均由 `session_state` 保存，并始终保留完整且不可变的 `origin`。
