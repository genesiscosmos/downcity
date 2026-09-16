# Session Runtime 架构

Session Runtime 的上位设计规则遵循
[`engineering-design-standard.md`](./engineering-design-standard.md)。本文记录当前实现必须保持的稳定组件边界与执行不变量。

## 1. 组件与所有权

```text
Agent
  └─ AgentSessions                 Session 集合、创建、恢复与归档
       └─ Session                  对外 facade 与单 Session 组合根
            ├─ SessionState        配置、标题与 Metadata
            ├─ SessionQueue        有序 Command
            ├─ SessionLoop         Queue 消费与 Turn 生命周期
            ├─ SessionComposition  system snapshot 与 Step 输入
            ├─ SessionMessages     canonical Message 领域规则与运行态投影
            ├─ SessionInteractions 运行时等待、超时与响应
            ├─ Executor            单次模型与 Tool Step Loop
            └─ SessionEventHub     未来 Mutation 广播
```

稳定所有权如下：

- `AgentSessions` 拥有 Session 集合，Workspace 只提供单个 Session 的执行资源。
- `SessionLoop` 是 Queue 的唯一消费者，也是 Active Turn 的唯一所有者。
- `session.db` 是 canonical Message 的唯一事实源；`SessionMessages` 只拥有领域规则、非终态恢复与有界运行态投影。
- `SessionComposition` 拥有 system snapshot；Composer 读取 canonical history，只有其 Context Policy 可写命名空间隔离的派生表。
- `Executor` 只执行一个已经建立的 Turn，不创建 Session、不持有历史 Store。
- `SessionInteractions` 只拥有 Promise、Timer 等进程内资源，终态必须先由 `SessionMessages` 提交。

## 2. Command 与 Turn

Session Queue 只有两类 Command：

- `prompt`：创建新 Turn，或在当前 Turn 的 Step 检查点作为 steer 合并。
- `maintenance`：配置更新、显式压缩等 Session 级操作；空闲时可以独立执行，不创建虚假 Turn。

Queue processor 由“是否存在 Command”驱动，Turn 只由 Prompt Command 创建。这保证：

1. 空闲 Session 的上下文压缩不依赖未来 Prompt。
2. Prompt、steer、配置和压缩仍严格遵守同一 FIFO。
3. Turn 运行期间的 Command 只在 Step 检查点生效。
4. Turn 在检查点前结束时，剩余 maintenance command 先尝试并入当前 Turn 的 Agent Message，无法并入时才在 Turn 收口后独立执行。

## 2.1 Action 落盘归属

Action 属于辅助活动记录，不是独立对话轮次。它的 canonical 归属规则是：

- 目标 Turn 仍有正在流式写的 Agent Message 时，Action Part 直接追加为该 Message 的一个 Part，与正文共享同一条 canonical Message。
- Session 空闲、目标 Turn 尚未产生 Agent Message，或已有 Message 已收口时，才回退为只含 Action Part 的独立 Agent Message。
- 同一次 Turn 结束时，`SessionLoop` 先抽干尚未处理的 maintenance Command，再收口 Assistant Message，避免收尾窗口内的配置变更落到 Turn 之外。

因此“执行中切权限 / 改模型”会呈现为当前回复内部的一条 activity action，而不再是一条割裂的独立气泡。

Action 只用于可观测的 Session 级操作，不承担 Turn 结果语义。当前取值：

- `command`：维护 Command 完成，例如改模型、改审批模式。
- `history-fork`：分叉完成后，写入分叉出的新 Session 末尾，记录复制条数与来源 Session。
- `context-compaction`：上下文压缩写入 checkpoint（`completed`）或摘要失败（`failed`）。Context Policy 判定没有可压缩区间时不产生 Action，避免空操作污染时间线。

## 3. Prompt 主链路

```text
prompt
  → Prompt Command 入队
  → SessionLoop 创建 TurnContext
  → SessionMessages 持久化 User Message
  → 每个 Provider Step 提交一次 Queue 检查点
  → Composer 从 session.db 组装一次 model、system、history 与 tools
  → CoreEngine 执行单个模型与 Tool Step
  → AssistantOutputAdapter 把 Step 结果写入 SessionMessages
  → 下一 Step 重新 Compose canonical history
  → Store 提交后发布 Mutation
  → 收口 Assistant、文件 Diff 与 Hook
  → 发布 Turn finish 并释放 TurnContext
```

User Message 与 Agent Message 的稳定语义检查点必须先提交 SQLite，再发布完整快照 Mutation。模型 stream 的 start、delta、finish 只更新当前 Agent Message 的有界内存投影并发布实时 Mutation；一个模型 Step 完成后，再用一次事务提交该 Step 的完整 Part 快照。Tool 执行前后的状态、Interaction 状态、Action/Error 等不可丢失的语义变化可以独立建立检查点。

这条边界可以概括为：事件负责实时展示，内存负责流式组装，数据库只保存稳定语义检查点。历史分页直接查询 SQLite，完整历史不常驻内存。

CoreEngine 不缓存第二份完整 `ModelMessage` 历史，也不拼接 Provider 原始 response。恢复提示等内部输入先持久化为 `visibility: "internal"` 的 canonical User Message；下一 Step 一律由 Composer 从 canonical history 重读，运行时没有额外输入旁路。

## 4. System 单一组装路径

`build_session_system_blocks()` 是默认 system block 的唯一组装入口，顺序固定为：

```text
Agent instruction → Downcity core → Plugin system → Session context
```

执行路径、`session.system()` 和控制面 system 预览都复用该入口。Plugin system 必须先经过
`session.system_context` Hook 检查点；旧的独立 `SessionSystemComposer/SystemDomain` 链路不再存在。

Session 首次执行会固定 system snapshot。`snapshot()` 和 `syncshot()` 将完整快照写入 `session.db` 的 `session_state.system_snapshot`；普通运行时变化不得静默重写已有 snapshot。

## 5. 持久化与恢复

```text
SessionStorage
  ├─ session.db
  │  ├─ session_state
  │  ├─ messages
  │  ├─ message_parts
  │  └─ composer_<policy>_* 派生表
  └─ attachments/*
```

核心表保存完整 canonical Message；Composer Policy 的 Summary、索引等只写自己的派生表，不改写原始历史。

默认 `AdaptivePartContextPolicy` 以 Part 而不是 Message/Turn 作为上下文处理边界：reasoning、action 与 interaction 不进入摘要；Tool call/result 作为一个 Part 保持原子；稳定 Part 可以在单个仍然很大的 Agent Message 内形成 checkpoint。摘要通过 `<session-context-summary>` 显式 system block 注入，不伪装成普通 assistant 历史。

Agent Message 只保存 `streaming | done` 两态：前者表示聚合仍可写，后者表示永久收口。成功、停止和失败属于 Turn 结果语义；需要持久化的停止或失败原因由 Error Part 表达。Message 进入 `done` 前，Text/Reasoning 与未完成的 Tool、Interaction、Action 必须在同一事务中收口。运行态缓存因此只保存 `streaming` Agent Message，终态历史始终查询 SQLite。

中断恢复的语义所有者只有 `SessionMessages`。Storage 只按 `messages.state = 'streaming'` 定向查询非终态 Agent Message，并原子提交领域层给出的 `done + Error Part` 恢复结果。上下文恢复只使用 `usage_pressure` 与 `provider_context_limit` 两种领域原因；Provider 错误文本只在 Executor 边界识别一次。

Message 创建与终态更新事务同时维护 `session_state.message_count`、`preview_text` 和 `updated_at`。上层不再追加重复 Metadata 写入；`get_info()` 只读取 `session_state`，标题任务只定向读取首条 User Message。

Session 只依赖 `SessionStorage` 协议，不拼接物理路径；来源分区、归档和路径编码由 `SessionStore` 与存储实现负责。

## 6. 依赖方向

```text
Session facade
  → State / Loop / Composition / Messages
  → Executor ports / Store ports / Hook ports
  → 具体 Store 与模型、Tool 实现
```

下层对象不得反向访问完整 Session。City、Transport、UI 和平台差异不得进入 Session 领域对象；扩展只通过 Hook、Tool、Interaction 和 Store 协议进入。
