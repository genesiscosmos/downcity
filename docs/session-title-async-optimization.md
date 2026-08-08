# Session 标题异步化优化方案

> 状态：设计方案
>
> 目标：将 Session 标题生成从用户 Prompt 的关键执行路径中移出，避免标题模型请求延长 `preparing`，同时保证标题最终一致、失败隔离、并发安全和可观测。

## 1. 背景与问题

当前首条 Prompt 的实际调用链如下：

```text
append_prompt_message
  → publish user message mutation
  → ensure_title_from_history({ generate: true })
  → 标题模型请求
  → touch_metadata
  → compose system / history / tools
  → 实际模型请求
  → 首个 assistant chunk
  → open_assistant_message
```

`SessionLoop.persist_prompt_message()` 在用户消息写入后同步调用标题生成。标题生成内部再次调用 `streamText()` 并等待 `result.text`，因此首轮对话可能产生两次模型请求。

同时，Assistant Message 当前是惰性创建的。`begin_step()` 只记录 step 已开始，只有收到第一个可持久化的 reasoning、text 或 tool chunk 后，`write_chunk()` 才会调用 `open_assistant_message()`。因此前端的 `preparing` 实际覆盖了“首个 assistant 输出之前的全部等待”，而不是只表示消息对象创建过程。

这造成三个问题：

1. 标题这种非关键业务被放入 Prompt 的同步关键路径。
2. 首轮 `preparing` 比后续轮次明显更长，用户无法解释差异。
3. 标题生成失败、超时或 provider 异常可能污染主执行链路的时延与日志，即使当前实现已经尽力吞掉标题错误，也仍然同步等待失败结果。

## 2. 产品意图与设计目标

### 2.1 产品意图

用户发送消息后，核心对话执行应立即向模型推进；标题只是 Session 列表和导航体验的增强信息，不应阻塞用户消息落盘、Turn 启动或 assistant 首次输出。

### 2.2 目标

- 用户消息 mutation 到达后，主 Turn 不再等待标题生成。
- 标题生成在 Session 生命周期内异步执行，并最终写入 Session metadata。
- 标题生成失败、取消、超时不影响 Turn 成功与否。
- 同一个 Session 同时最多有一个标题生成任务，避免重复请求和竞态覆盖。
- 标题只由首条有效 user message 生成；已存在标题时不再自动重算。
- 标题更新继续通过 `variant: "session", type: "title"` mutation 对外发布。
- Session dispose、删除或归档时，标题后台任务可以安全终止或丢弃结果。
- 能区分标题任务耗时与实际模型首 token 耗时。

### 2.3 非目标

- 不改变标题的生成模型、提示词或标题格式。
- 不把标题写入 canonical Message；标题仍属于 Session metadata。
- 不改变 `session.prompt()`、`session.subscribe()` 的公开 API。
- 不重新设计 Renderer activity 状态机；`preparing` 是否在 assistant message 创建前持续，另见第 8 节。

## 3. 设计原则

### 3.1 Session metadata 与 Turn 执行解耦

标题属于 Session metadata，不属于 Turn 结果。标题任务不能由 `SessionLoop.execute_prompt_command()` 以 `await` 方式串接。

### 3.2 单一事实源

- 标题的权威状态仍是 Session metadata store。
- 内存中的标题任务状态只是不可持久化的运行时调度状态，崩溃后可重建。
- 标题生成结果必须重新读取 metadata 后再提交，不能依据过期快照强行覆盖。

### 3.3 失败隔离

标题任务是 best-effort side effect。任何异常只能记录诊断并结束标题任务，不能抛回 Prompt、Executor 或 Turn Handle。

### 3.4 生命周期闭合

创建标题任务的 Session 负责管理任务句柄、取消信号和结果提交；Session dispose 时取消未完成请求，任务完成后清理引用。

### 3.5 明确检查点

标题任务可以在用户消息成功落盘并发布 mutation 后排队，但提交结果前必须再次检查：Session 未 dispose、metadata.title 仍为空、首条 user message 仍是生成依据、任务未被取消。

## 4. 推荐方案：Session 内置异步 Title Task

### 4.1 职责拆分

建议把当前 `SessionState.ensure_title_from_history()` 拆成两个语义明确的操作：

```text
read_title_snapshot()       只读 metadata 与首条 user message
schedule_title_generation() 负责去重、取消、调用模型和提交 title mutation
```

标题生成的状态由一个私有运行时协调器持有，例如 `SessionTitleTask`。它只依赖最小的 metadata、消息快照、模型和事件发布能力，不拥有 Message Store，也不参与 Turn 编排。

### 4.2 主路径调整

`persist_prompt_message()` 的推荐顺序：

```ts
const message = await messages.append_prompt_message(...);
await state.touch_metadata();
title_task.schedule();
return message;
```

`schedule()` 不返回需要主路径等待的 Promise；它应同步完成“是否需要启动任务”的判断，然后由协调器安全地启动后台流程。不建议使用未捕获的裸 `void generate_title()`。

### 4.3 去重与竞态控制

同一个 Session 使用 single-flight 策略：已有 `active_task`、metadata 已有 title、或没有有效首条 user message 时都不重复启动。

任务开始时记录首条 user message 的 `message_id` 与 `revision`。模型返回后重新读取 metadata 和首条 user message：若 title 已被写入、首条消息已变化、Session 已关闭或任务已取消，则丢弃结果；否则写入 metadata 并发布 `session/title` mutation。

### 4.4 任务取消与生命周期

Title Task 使用独立 `AbortController`，不复用 Turn 的 abort signal：`session.stop()` 只停止 Turn；`session.dispose()`、Session 删除或归档时取消标题任务。即使 provider 不支持 abort，也必须在结果提交前检查取消状态。任务在成功、失败、取消三种结果下都要在 `finally` 清理引用。

## 5. 标题生成时机

推荐在 `append_prompt_message()` 成功提交首条 user message 并发布 mutation 后调度，且同时满足：metadata 没有非空 title、Session 允许后台任务运行、Agent 有可用模型。

首条消息判断应基于 canonical history 或 metadata 的明确字段，不要仅依赖 `SessionLoop` 的 `prompt_started`，因为恢复 Session、Remote Session 和多宿主场景可能绕过当前内存实例的首次执行状态。

如果产品需要列表立即有标题，可以使用本地 deterministic fallback（例如截断首条 user text）作为展示层 fallback；除非产品明确接受，否则不要把 fallback 写入 canonical title。

## 6. 失败、重试与持久化语义

标题任务至少区分 `cancelled`、`missing_model`、`provider_error`、`empty_result`、`stale_result` 和 `storage_error`。这些状态只进入结构化日志或内部指标，不改变 Turn 的 `success`、`error` 或 `finished` 结果。

第一阶段建议只实现单次 best-effort，不自动重试。若指标显示临时 provider 错误较多，再增加最多一次的后台短退避重试；空结果和 stale result 不重试。

## 7. 可观测性与验证指标

标题任务记录：

```text
session_title.schedule / start / finish
session_title.duration_ms
session_title.result: success | skipped | cancelled | stale | error
session_title.model_label
session_title.first_user_message_id
```

Turn 侧记录：`prompt_received_at`、`user_mutation_published_at`、`execution_started_at`、`stream_requested_at`、`assistant_first_chunk_at`、`assistant_mutation_published_at`。这样可以将 `preparing` 拆成标题任务、执行前准备、模型首 token 和 IPC/Renderer 延迟。

## 8. `preparing` 状态的后续优化

标题异步化只能移除标题模型请求造成的延迟，不会改变 assistant message 当前“首个 chunk 才创建”的语义。

如果希望 UI 更早从 user message 的 `preparing` 转为 assistant 的 `thinking`，应单独引入 `assistant_start` lifecycle mutation，而不是伪造空的 assistant Message：

```text
turn start
→ assistant_start mutation（携带 assistant_message_id）
→ 创建 canonical assistant message
→ thinking
→ reasoning / tool / text mutation
```

这会影响 Message Store、Activity Store、IPC 协议和 Renderer，属于独立的跨模块设计，不应与标题异步化混成一个小补丁。第一阶段先异步化标题，恢复正确的执行时延边界。

## 9. 迁移步骤

1. 新增 Session 内部 Title Task 协调器，定义任务状态和取消协议。
2. 将 `ensure_title_from_history({ generate: true })` 迁移为只读检查与 `schedule_title_generation()`。
3. 从 `persist_prompt_message()` 移除标题生成的 `await`。
4. 在 Session dispose、remove、archive 路径接入任务取消。
5. 为 stale result、重复 schedule、provider error、Session 删除补测试。
6. 增加标题任务与 Turn 首 chunk 的结构化耗时日志。
7. 验证本地 Session、Remote Session、恢复 Session 和多个并发 Session。
8. 根据指标决定是否实现后台重试及独立 assistant lifecycle mutation。

## 10. 验收标准

- 用户消息 mutation 发布后，Prompt 主执行不等待标题模型返回。
- 标题生成失败不会导致 Turn 失败，也不会延迟 assistant 首个 chunk。
- 同一 Session 不会并发发起两个标题请求。
- 已存在 title 时不会自动覆盖。
- Session 删除、归档或 dispose 后，旧标题结果不会重新写回。
- 标题成功后仍发布 `variant: "session", type: "title"` mutation。
- 重启后标题任务状态可安全丢失并按规则重建，不影响 canonical history。
- 标题任务耗时和实际模型首 chunk 耗时可以在日志中独立观测。

## 11. 结论

标题生成应被视为 Session metadata 的异步增强任务，而不是 Prompt 的前置步骤。最佳实践是：先提交 user message，立即推进 Turn；标题任务由 Session 自己调度、去重、取消、隔离失败，并在结果提交前做新鲜度校验。

这样既保持标题最终一致，也让 `preparing` 只反映真正的对话执行准备和模型首 token 延迟。
