# Execution Module

`executor/` 是模型请求与 Tool Loop 的低层执行内核；Session 级编排在 `session/runner/`。普通 SDK 用户只通过 `Session` 调用它。

完整 Session Runtime 设计见 [`docs/session-runtime-architecture.md`](../../../../docs/session-runtime-architecture.md)。

## 边界

- `Session` 拥有输入队列并创建 Command；`SessionLoop` 负责消费、Turn Handle 与 Assistant Message 收口。
- `SessionTurnContext` 从 Turn 创建起唯一拥有取消信号、Step 快照和执行期资源。
- `SessionComposer` 根据只读 Session 快照组装 system、messages 和 tools。
- `StepInputAssembly` 是 SessionLoop 的「输入环境」：刷新 Hook、请求 Composer 组装、套用冻结 system snapshot、绑定工具执行上下文。
- `SessionExecutor` 负责模型请求与 Tool Loop、续写恢复、上下文超限恢复和真实 usage 观测；它只对外提供 `execute()`，Step 输入由回调提供。
- `ModelRequestRunner` 唯一拥有普通模型请求的五次重试、退避和逐次失败通知。
- `SessionMessages` 是 Message 唯一事实源；执行层不写文件、不持有 Store。

## 执行关系

```mermaid
flowchart LR
    Loop["SessionLoop"] --> Context["SessionTurnContext"]
    Loop --> Assembly["StepInputAssembly"]
    Assembly --> Composer["SessionComposer"]
    Composer --> Input["system + messages + tools"]
    Context --> Executor["SessionExecutor"]
    Input --> Executor
    Executor --> Request["ModelRequestRunner"]
    Request --> Step["ModelStepRunner"]
    Step --> Model["ModelClient"]
    Executor --> Tools["Tools / Plugins"]
    Model -->|"ModelStreamEvent"| Step
    Step --> Request
    Step -->|"ModelStreamEvent / Tool Result"| Context
    Context --> Messages["SessionMessages"]
```

每个模型 Step 前，`SessionLoop` 先消费排队的 Steer 和状态 Command。`StepInputAssembly` 随后捕获最新 effective state，并调用 Composer 生成完整 Step 输入。

```text
Session.prompt()
  -> SessionLoop 持久化 canonical User Message
  -> StepInputAssembly 捕获只读 Session 快照
  -> SessionComposer.compose()
  -> SessionModelMessages: SessionMessage -> ModelMessage
  -> SessionExecutor.execute()
  -> Federation / Provider 返回 ModelStreamEvent
  -> SessionAssistantOutput 直接更新 canonical Assistant Message
  -> SessionMessages 持久化并发布 Mutation
```

## 旧 Composer 去向

过去的四个独立 Composer 不再构成执行管线：

| 旧能力 | 当前归属 |
| --- | --- |
| `SystemComposer` | `DefaultSessionComposer.compose()` + `SessionSystem` |
| `HistoryComposer` | `SessionComposer.compose()` + `SessionModelMessages` |
| `ContextComposer` 的 tools | `Session.create_compose_input()` + `SessionComposer.compose()` |
| `ContextComposer` 的 Step Callback | `SessionLoop` + `StepInputAssembly` |
| `ContextComposer` 的 fallback Assistant | `SessionExecutor` + `ExecutorRecoveryPolicy` |
| `CompactionComposer` | `SessionComposer.advance_context()` + `session/composer/` 内的算法与派生表 |

统一 Composer 只回答一个策略问题：

1. 当前 Step 的 system、messages 和 tools 是什么？上下文超限时能否推进派生上下文？

Queue 消费、Turn 控制、Message 写入和 Mutation 发布都不是 Composer 职责。

## Context advance

```text
SessionLoop / ExecutorRecoveryPolicy
  -> Session.advance_context(trigger)
  -> SessionComposer.advance_context()
  -> 默认实现在自己的 checkpoint 派生表推进边界
  -> 下一次 compose() 读取最新派生上下文
```

Composer 只接收调用方读好的 canonical history 快照与命名空间派生存储；它可以调用模型生成摘要，
但不能修改 canonical Message、Metadata 或发布事件。持久化提交始终由 `SessionStorage` 事务完成。

## 目录

```text
executor/
  core-engine/       模型与 Tool Loop 的纯逻辑（signals / loop decision / error）
  composer/system/   可复用的默认 system prompt 领域实现
  messages/          Session 与 Model Protocol 消息转换
  services/          执行恢复策略
  tools/             Tool 运行辅助
  types/             Executor 内部类型

session/runner/
  SessionExecutor.ts       模型请求与 Tool Loop 执行器
  StepInputAssembly.ts     每个 Step 的模型输入装配
```
