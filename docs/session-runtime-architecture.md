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
            ├─ SessionMessages     canonical Message 唯一事实源
            ├─ SessionInteractions 运行时等待、超时与响应
            ├─ Executor            单次模型与 Tool Step Loop
            └─ SessionEventHub     未来 Mutation 广播
```

稳定所有权如下：

- `AgentSessions` 拥有 Session 集合，Workspace 只提供单个 Session 的执行资源。
- `SessionLoop` 是 Queue 的唯一消费者，也是 Active Turn 的唯一所有者。
- `SessionMessages` 是 Message、Assistant 草稿、Interaction 状态和压缩 Segment 的唯一事实源。
- `SessionComposition` 拥有 system snapshot；Composer 只读取不可变输入，不写 Store。
- `Executor` 只执行一个已经建立的 Turn，不创建 Session、不持有历史 Store。
- `SessionInteractions` 只拥有 Promise、Timer 等进程内资源，终态必须先由 `SessionMessages` 提交。

## 2. Command 与 Turn

Session Queue 只有两类 Command：

- `prompt`：创建新 Turn，或在当前 Turn 的 Step 检查点作为 steer 合并。
- `maintenance`：配置更新、显式压缩等 Session 级操作；空闲时可以独立执行，不创建虚假 Turn。

Queue processor 由“是否存在 Command”驱动，Turn 只由 Prompt Command 创建。这保证：

1. 空闲 Session 的 `compact()` 不依赖未来 Prompt。
2. Prompt、steer、配置和 compact 仍严格遵守同一 FIFO。
3. Turn 运行期间的 Command 只在 Step 检查点生效。
4. Turn 在检查点前结束时，剩余 maintenance command 在 Turn 收口后继续执行。

## 3. Prompt 主链路

```text
prompt
  → Prompt Command 入队
  → SessionLoop 创建 TurnContext
  → SessionMessages 持久化 User Message
  → Executor 请求 SessionComposition 生成 StepInput
  → Composer 组装 system、history 与 tools
  → 模型和 Tool Step Loop
  → AssistantOutputAdapter 写入 SessionMessages
  → Store 提交后发布 Mutation
  → 收口 Assistant、文件 Diff、Metadata 与 Hook
  → 发布 Turn finish 并释放 TurnContext
```

任何 canonical Message 都必须先持久化，再进入内存投影并发布 Mutation。写入失败不得产生伪完成事件。

## 4. System 单一组装路径

`build_session_system_blocks()` 是默认 system block 的唯一组装入口，顺序固定为：

```text
Agent instruction → Downcity core → Plugin system → Session context
```

执行路径、`session.system()` 和控制面 system 预览都复用该入口。Plugin system 必须先经过
`session.system_context` Hook 检查点；旧的独立 `SessionSystemComposer/SystemDomain` 链路不再存在。

Session 首次执行会固定 system snapshot。`snapshot()` 显式写入 `instruction.md`，`syncshot()` 显式按当前 Agent instruction 与 Plugin 重新生成；普通运行时变化不得静默重写已有 snapshot。

## 5. 持久化与恢复

```text
SessionDataStore
  ├─ meta.json
  ├─ instruction.md
  ├─ messages/active.jsonl
  ├─ messages/segments/*.jsonl
  └─ attachments/*
```

Active 保存最近的真实 Message；Compact 把连续前缀提交为不可变 Segment，并保存累计 Summary。Summary 只服务模型上下文，不替代用户可浏览的原始 Message。

Session 只依赖 `SessionDataStore` 协议，不拼接物理路径；来源分区、归档和路径编码由 `SessionStore` 与存储实现负责。

## 6. 依赖方向

```text
Session facade
  → State / Loop / Composition / Messages
  → Executor ports / Store ports / Hook ports
  → 具体 Store 与模型、Tool 实现
```

下层对象不得反向访问完整 Session。City、Transport、UI 和平台差异不得进入 Session 领域对象；扩展只通过 Hook、Tool、Interaction 和 Store 协议进入。
