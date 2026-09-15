# Session Message 统一模型 PRD（state 推导化）

> 状态：设计待评审（未落地）
>
> 适用范围：`@downcity/agent` Session Runtime、`@downcity/type` Session 协议、`@downcity/city` transport
>
> 上位规范：[Downcity 工程设计与代码演进规范](./engineering-design-standard.md)
>
> 本文**取代** `session-draft-message-redesign-prd.md`。那一版引入 `draft` 表把 Transcript 与 Draft 分成两个容器，是把一个字段冗余问题误判为概念缺口，反而破坏了代码库已有的统一。本版收回该方案。

## 1. 先修正上一版的错误

上一版的核心结论是错的，逐条收回：

| 上一版主张 | 实际 |
| --- | --- |
| 需要第二张 `draft` 表 | 不需要。Message 表已是唯一容器 |
| 需要 `SessionDraft` 实体 | 不需要。正在写的输出就是一条 Message |
| 需要改 Mutation 协议（4 个新 variant） | 不需要。现有 variant 足够 |
| 需要改 desktop / ui / cli 七个位置 | 不需要 |
| 需要删 `revision` | 错。`revision` 是"这条 Message 当前版本"，需要保留 |
| 需要 `sequence` 计数器 | 不需要。单表下 `MAX(sequence)+1` 仍然正确 |
| 需要 `held_by_writer` 作为推导输入 | 不需要（见 §3.3） |
| 需要 `resolve_message_state` 之类的推导函数 | **需要，但只有这一个** |

代码库的既有统一（`turn → message → part`，一张 `messages` 表一张 `message_parts` 表）是对的，本版不动机器结构。

## 2. 真正的缺陷：一个被存起来的推导值

`SessionMessage.state` 的信息完全来自它的 Parts：有进行中的 Part 就是 `streaming`，否则 `done`。但它被**存成了字段**，于是变成一份需要人工同步的副本。

### 2.1 存储层早已知道真相在 Part 里

`packages/agent/src/session/storage/SqliteSessionStorage.ts:648`：

```ts
const has_non_terminal_part = message.parts.some((part) => {
  if (part.type === "text" || part.type === "reasoning") return part.state === "streaming";
  if (part.type === "tool") return part.state !== "completed" && part.state !== "failed";
  if (part.type === "action") return part.state === "running";
  return false;
});
if (has_non_terminal_part && message.state !== "streaming") {
  throw new Error(`Non-terminal Agent Part requires a streaming Message: ${message.message_id}`);
}
```

这段代码已经写出了推导规则，却**只校验一个方向**：有未完成 Part ⇒ 必须 `streaming`。反向从未校验——那个缺口就是缺陷来源。

### 2.2 同一个字段被读出两个意思

`SqliteSessionStorage.ts:561` 的 `update_message_projection_unsafe`：

```ts
if (!created && message.role === "agent" && message.state === "streaming") {
  return;   // 跳过 preview_text / message_count 更新
}
```

这里的 `streaming` 意思是"还没进已提交历史"；`validate_parts` 里的 `streaming` 意思是"有未完成 Part"。同字段、同文件、两个含义。

### 2.3 六个写入点

| 位置 | 代码 | 依据 |
| --- | --- | --- |
| `SessionMessages.ts:230` | `state: "streaming"` | writer 创建消息 |
| `SessionMessages.ts:388` | `state: event.status === "running" ? "streaming" : "done"` | 事件的 Action 状态 |
| `SessionMessages.ts:427` | `state: status === "running" ? "streaming" : "done"` | parts 中第一个 Action 状态 |
| `SessionMessages.ts:510` | `state: "done"` | 新建仅含 error 的消息 |
| `SessionMessages.ts:116` | `state: "done"` | 重启修复 |
| `SessionAgentMessageState.ts:323` | `state: options?.state ?? "streaming"` | 提交快照默认值 |

六处、四种依据，没有一处是"该 Message 自身 Parts"的函数。

### 2.4 缺陷实证（已运行验证）

```text
persist_action(running,   turn_id=turn-1) -> state=streaming  parts=[action:running]
persist_action(completed, turn_id=turn-1) -> state=streaming  parts=[action:completed]
重启恢复                                   -> state=done  parts=[action:completed, error:runtime_interrupted]
```

根因：`find_streaming_agent_message` 按 `state` 查找正文目标，命中了上一步刚建的 Action 消息，走内联分支，而收口逻辑在另一个分支。字段副本没被更新。

## 3. 统一模型

### 3.1 唯一规则

> **Message 不保存 `state`。**
> 它是读取边界的推导值，唯一输入是自己的 Parts。

```ts
// packages/agent/src/session/messages/SessionMessageState.ts

/** 判断 Part 是否仍在进行中。 */
export function is_session_part_in_flight(part: SessionAgentMessagePart): boolean {
  switch (part.type) {
    case "text":
    case "reasoning":
      return part.state === "streaming";
    case "tool":
      return part.state !== "completed" && part.state !== "failed";
    case "action":
      return part.state === "running";
    case "file":
    case "data":
    case "error":
      return false;
  }
}

/**
 * 推导 Message 的展示状态。
 *
 * 唯一规则源。存储不保存 state，订阅与读取都在边界调用本函数，
 * 因此它不可能与 Parts 不一致。
 */
export function resolve_session_message_state(
  parts: readonly SessionAgentMessagePart[],
): SessionMessage["state"] {
  return parts.some(is_session_part_in_flight) ? "streaming" : "done";
}
```

### 3.2 为什么一个函数就够

因为**推导是纯函数，且没有第二份副本**。`state` 不再有写入点，所以"6 处各自决定"变成"0 处决定、1 处计算"。§2.3 的整张表消失。

`state` 仍出现在类型与订阅负载上——客户端需要它画光标——但它由边界计算填入，业务代码不得赋值。

### 3.3 为什么不需要 `held_by_writer`

上一版说"刚创建、还没有任何 Part 的 Message"会让推导失真（空 Parts ⇒ 推导为 `done`，但它其实在写）。这是真的，但解法不是引入运行时输入，而是**消除这个特例**：

> **Message 在拥有第一个 Part 时落盘。**

于是不存在"空的未完成 Message"，推导覆盖全部 Message：

- 有进行中 Part → `streaming`；
- 无进行中 Part → `done`；
- 空 Parts 的 Message 在存储中不存在。

这条改动顺带消掉现有的空行：进程在首个 token 前崩溃时，现在会留下一条空 Message 被恢复逻辑补错误 Part，之后不会再留。

### 3.4 「谁在写」由持有关系回答

`state` 被删后，"我正在写哪条 Message"不再靠字段查询，而由 writer 持有：

```ts
/** 当前打开的 writer；它就是正在写的那条 Message。至多一个。 */
private open_writer: SessionAgentMessageWriter | null = null;
```

`find_streaming_agent_message`（扫描缓存 + 按 state 筛）、`remember_message` 的 state 过滤、`require_streaming_agent` 的 state 守卫，全部由这一个引用取代。

## 4. 目标代码

### 4.1 存储

只删一列，不加表：

```sql
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  turn_id TEXT,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  role TEXT NOT NULL CHECK (role IN ('user', 'agent')),
  -- state 列删除；连带删除原 CHECK(role/state) 约束
  visibility TEXT NOT NULL CHECK (visibility IN ('visible', 'internal')),
  origin_session_id TEXT,
  origin_message_id TEXT,
  origin_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`session_state.message_count` 改为按 Transcript 实际行数递增（不再依赖 state 判断是否跳过）。

### 4.2 收口：一份逻辑

`SessionMessages.restore_messages`（进程恢复）与 `SessionAgentMessageState.complete`（正常收口）各有一份逐字相同的「把 pending Interaction 标为 cancelled」逻辑，合并为一份纯函数：

```ts
// packages/agent/src/session/messages/SessionMessageSettlement.ts

/** 收口原因；决定未完成 Part 的终态。 */
export interface SessionPartSettlement {
  /** 收口原因；`interrupted` 用于进程恢复。 */
  outcome: "completed" | "stopped" | "failed" | "interrupted";
  /** 覆盖未完成 Part 说明的错误文本。 */
  error?: string;
}

/** 把所有进行中的 Part 终结为确定状态。纯函数，收口与恢复共用。 */
export function settle_session_parts(
  parts: readonly SessionAgentMessagePart[],
  settlement: SessionPartSettlement,
  at: number,
): SessionAgentMessagePart[];
```

沿用现有文案（不在本次一并调整，见 §6）。

### 4.3 恢复：按 Part 查，不按 state 查

```sql
-- 取代 list_recoverable_agent_messages 的 WHERE state = 'streaming'
SELECT m.* FROM messages m
WHERE m.role = 'agent'
  AND EXISTS (
    SELECT 1 FROM message_parts p
    WHERE p.message_id = m.message_id
      AND json_extract(p.content, '$.state') IN
          ('streaming', 'input-streaming', 'ready', 'waiting-user', 'running')
  )
ORDER BY m.sequence ASC
```

推导规则从存储层的一行校验（§2.1）升级为查询条件本身：**"需要恢复"就是"存在进行中的 Part"**。

按 §3.3，这类 Message 至多一条。

### 4.4 `persist_action`

三分支结构保留（内联是产品要求），只把"查找正文目标"的依据从 state 换成持有关系：

```ts
async persist_action(event: SessionActionEvent, options?): Promise<void> {
  await this.ensure_initialized();
  const publish_mutation = options?.publish_mutation !== false;

  // 分支 1：改由「writer 是否持有该 Turn 的 Message」判定，不再看 state。
  const body = event.turn_id ? this.open_message_of_turn(event.turn_id) : undefined;
  if (body) { await this.commit_parts(body.message_id, [part], { publish_mutation }); return; }

  // 分支 2 / 3：载体 Message。
  const existing = this.get_message(event.action_id) ?? await this.store.read_message(event.action_id);
  if (!existing) { await this.create_message(...); return; }
  await this.commit_parts(existing.message_id, [part], { publish_mutation });
}
```

不再有 `state: event.status === "running" ? "streaming" : "done"`（§2.3 第 2 行）与 `update_action_part` 的 state 反推（第 3 行）：Part 写完后状态由 §3.1 推导。

**§2.4 的缺陷就此消失**：完成的 Action ⇒ 无进行中 Part ⇒ 推导为 `done` ⇒ 不再进入恢复集 ⇒ 不会被追加 `runtime_interrupted`。

### 4.5 写入的变更

| 位置 | 变化 |
| --- | --- |
| `open_agent_message` | 只登记持有，不落盘；首个 Part 提交时创建行 |
| `SessionAgentMessageState.commit_parts` | 首次调用时插入 Message 行，之后更新 |
| `SessionAgentMessageState.complete` | 调 `settle_session_parts`，写入后推导 state |
| `SqliteSessionStorage` | 去掉 `message.state` 的读写与校验；新增按 Part 的恢复查询 |
| `SessionMessageInteractionWriter` | 只把 `state === "streaming"` 的选取改为"writer 持有的 Message"，其余不变 |

## 5. 删除清单

| # | 符号 | 位置 | 替代 |
| --- | --- | --- | --- |
| 1 | `messages.state` 列 + `CHECK` 块 | `SessionStorageSchema.ts:41` | §3.1 推导 |
| 2 | `state` 的 6 个写入点 | §2.3 | 0 处 |
| 3 | `find_streaming_agent_message` | `SessionMessages.ts:335` | `open_writer` |
| 4 | `resolve_streaming_action_part` 的 state 参数 | `SessionMessages.ts:346` | 推导 |
| 5 | `remember_message` 的 state 过滤 | `SessionMessages.ts:773` | `open_writer` |
| 6 | `require_streaming_agent` 的 state 守卫 | `SessionAgentMessageState.ts:354` | writer `closed` |
| 7 | `persist_snapshot` 的 `state` 参数与默认值 | `SessionAgentMessageState.ts:317,323` | 推导 |
| 8 | `update_action_part` 的 state 反推 | `SessionMessages.ts:427` | 只写 Part |
| 9 | `create_standalone_action_message` 的 state 条件 | `SessionMessages.ts:388` | 推导 |
| 10 | `validate_parts` 的非终态校验 | `SqliteSessionStorage.ts:648` | 构造性事实 |
| 11 | `restore_messages` 与 `complete` 的重复收口 | `SessionMessages.ts:107`、`SessionAgentMessageState.ts:~200` | `settle_session_parts` |
| 12 | `list_recoverable_agent_messages` 的 state 查询 | `SqliteSessionStorage.ts:280` | §4.3 查询 |
| 13 | `AdaptivePartContextPolicy` 的 message.state 门禁 | `AdaptivePartContextPolicy.ts:185` | 只看 Part state |
| 14 | `SessionLoop` 的 message.state 检查 | `SessionLoop.ts:630` | 无 |
| 15 | `update_message_projection_unsafe` 的 state 跳过 | `SqliteSessionStorage.ts:561` | 按行数递增 |

## 6. 不做什么

- **不加表、不改表结构**（只删一列）。
- **不改 Mutation variant。** `message` / `part` / `delta` / `turn` / `file_diff` / `session` / `warning` 全部保留。
- **不改 desktop / ui / cli。** 客户端读到的 `state` 仍存在，只是来源从存储列变成边界推导。`packages/ui/src/lib/session-message.ts:57` 的 `record.state === "streaming"` 无需改动。
- **不删 `revision`。** 上一版主张删除是错的：`revision` 是"这条 Message 当前版本"，实时更新需要它排序与去重。
- **不改 Interaction 的嵌套结构。** 它归属 Tool 是正确的（归属即结构、并发模型自明、同一事务提交）。
- **不改 `SessionMutationFactory` 的七分支 switch。** `SessionPartMutation` 按 `type` 展开，改写会失去编译器对 `type` 与载荷配对的校验。
- **不调整收口文案。** `settle_session_parts` 沿用现有四种原因的文本，避免把行为变更混进结构收敛。
- **不处理 `project_delta` 的 O(n²) 克隆**（附录 A）。

## 7. 迁移批次

两批，都可独立回滚。

### 批次 A：删除冗余字段（结构，行为不变）

| 编号 | 内容 |
| --- | --- |
| A1 | 新增 `is_session_part_in_flight` / `resolve_session_message_state` |
| A2 | 新增 `settle_session_parts`，`complete` 与 `restore_messages` 改调它 |
| A3 | writer 持有取代 state 查找（§5 的 3、4、5、6 项） |
| A4 | Part 写入后由 §3.1 推导 state；删除 §5 的 7、8、9 项 |
| A5 | 存储层改为读写时推导，删除 §5 的 1、10、15 项 |

A 结束时 `messages.state` 列仍存在，但值由推导写入——即"一处计算、一处落盘"，与目标语义一致，可作为回滚点。

可选子项：若希望彻底不落盘，把 A5 拆成"先按推导写、再删列"两步。

### 批次 B：恢复路径（行为变更）

| 编号 | 内容 |
| --- | --- |
| B1 | Message 在首个 Part 落盘时创建（§3.3），消除空 Message |
| B2 | 恢复查询改为 §4.3；删除 `list_recoverable_agent_messages` |

**缺陷在 B1 之前就已消失**（A4 即修复），B 只是让模型自洽。

## 8. 验证

### 8.1 设计期已完成

`is_session_part_in_flight` 与 `resolve_session_message_state` 的同构实现曾以真实文件入仓验证：`pnpm -C packages/agent typecheck` 通过（并用故意注入的类型错误确认检查覆盖新文件），8 条断言覆盖规则两个方向、`running → completed` 推导为 `done`、已终态 Part 不被改写、pending Interaction 随 Tool 终止、`completed`/`failed` 的 Action 映射。8/8 通过，验证后文件已删除。

### 8.2 落地期

```bash
pnpm -C packages/type build && pnpm -C packages/agent build && pnpm -C packages/city build
pnpm -C packages/agent typecheck && pnpm -C packages/agent test   # 75/75
pnpm -C packages/city typecheck && pnpm -C packages/city test
```

**批次 A 后必须新增一条测试**（现无覆盖，且是本次唯一行为变更）：带 `turn_id` 的 Action 由 `running` 更新为 `completed` 后，Message 推导为 `done`，且重新 `initialize()` 不追加 `runtime_interrupted`。位置：`packages/agent/scripts/session-action-part.test.mjs`。可直接取附录 B 的示例 2 作为起点。

**批次 B 后新增一条**：Message 无 Part 时不落盘；首个 Part 提交后才出现行。

### 8.3 既有失败基线（与本设计无关，已核实）

- `packages/city`：`ImagePlugin image_result stores remote images locally`、`running session approval mode changes stay queued until the next Session step`
- 全仓库 `pnpm typecheck`：`templates/ui` 引用 `@downcity/ui` 未导出的 `ChatInputEditor`

## 9. 待决策

1. **`state` 是否彻底不落盘。** 本设计 A5 后它仍写库一次（便于回滚），可进一步删列。删列后 `message.state` 只存在于类型与订阅负载。我倾向删列，但想先确认没有外部消费者直接读 `messages` 表。
2. **`AdaptivePartContextPolicy` 的语义。** 现在它要求 `message.state === "done"`，删除后只看 Part state，这意味着正在写的 Message 也可能进上下文。需要确认这是否是期望行为（我认为是：进行中最后一步的 text Part 会读到 `done`，符合原意）。
3. **§3.3 的落盘时机。** 首个 Part 落盘会改变 `sequence` 的分配时刻（从 open 时变为首次写入时）。当前行为是 open 时即分配，顺序上二者等价（同一个 Turn 内）。需要确认。**不在本次范围**：是否把 desktop 的流程改成不收中间态。

## 附录 A：真实链路验证记录

以下结论来自五条真实链路的端到端追踪（非单元测试）。它们既是本设计的支撑证据，也暴露了三个不在本次范围的问题。

### A.1 四个分支的调用面

| 分支 | 关键观测 | 与本设计的关系 |
| --- | --- | --- |
| 初始化 | 默认存储是内存（`AgentMemoryStorageProvider` / `MemoryStorageProvider`），磁盘需显式注入 `LocalStorageProvider` | 无 |
| 普通 Turn | `prompt()` 返回句柄；消息 `state` 正确收敛为 `done` | 已验证 |
| steer | 同一 `turn_id` 下会产生**多条** Agent Message | 下见 A.2 |
| Tool + 审批 | Interaction 嵌在 Tool Part 内，同一次 Part mutation 滚动生命周期 | 结构确认 |
| 进程崩溃恢复 | 已完成 Action 不再被误报中断 | **本次核心修复的进程级确认** |

### A.2 `turn_id` 不唯一确定一条 Message

Turn 运行中再次 `prompt()`（steer）时，`commit_step_input` 会先关闭当前 Assistant Message 再开一条新的：

```ts
// SessionLoop.ts:561
commit_step_input: async () => {
  const had_pending_prompt = this.has_pending_prompt();
  await this.drain_queued_inputs();
  if (had_pending_prompt) await assistant_output.close_current_message();
},
```

实测同一 Turn 内产生两条 Agent Message：

```text
user  seq=1  "第一个问题"
agent seq=2  "第一段回答"     ← 被 steer 截断
user  seq=3  "补充问题"
agent seq=4  "第一段回答"     ← 新开
```

两个 `prompt()` 返回**同一个 `turn_id`**。因此 `find_open_message(turn_id)` 不能单独依赖 `turn_id` 定位，必须先用 writer 引用定位再用 `turn_id` 校验（当前实现是两者 AND）。

### A.3 `revision` 是提交计数，不是可见变更计数

两种表现：

**空跳**：Tool 阶段观察到 `rev=1 → rev=3`，没有 `rev=2` 的 mutation。因为 `persist_snapshot` 无条件 `revision + 1`，但 `changed_parts` 为空时不发 mutation。

**重复**：`part/tool state=running rev=4` 与 `part/tool state=completed rev=4` 是两次不同的 Part 变更，却带同一个 `revision`。

结论：`revision` 单调不减，但不保证每个 mutation 各不相同。消费端必须用严格大于去重（desktop 当前写法 `current.revision > mutation.revision` 正确）；**写成 `>=` 会丢状态**。这是一个隐性契约，建议在协议注释中明示。

### A.4 崩溃恢复：检查点粒度导致内容丢失

实测一个真实 SIGKILL（写到一半：流式 text + 未完成 tool）：

```text
崩溃前（磁盘）： state=streaming  parts=[]          ← 空的
重启后：        state=done  parts=[error:runtime_interrupted]
```

内存投影中的 text 与 tool 全部丢失，磁盘上只留下一个空壳消息，恢复后变成一条「只有错误、没有内容」的 Agent Message。

原因：`checkpoint_agent_message` 只在 step 结束、tool 输入就绪、tool 结果等时机调用，流式中间内容不落盘。

这是设计取舍（不落中间态换性能，与 §附录 B 的 O(n²) 同源），不是缺陷。但两个可改进点：

1. 空壳消息本不该存在——本设计 §3.3「首个 Part 落盘时才创建 Message」正好消除它；
2. 恢复后给用户的观测是「半句话变成了一个错误」，需要在 UI 层决定如何呈现。

### A.5 本次修复的进程级前后对比

同一场景：`persist_action(completed)` 后进程被 SIGKILL，再重启。

| | 崩溃前（磁盘） | 重启后 |
| --- | --- | --- |
| 改动前 | `state=streaming` `[action:completed]` | `state=done` rev=**3** `[action:completed, error:runtime_interrupted]` |
| 改动后 | `state=done` `[action:completed]` | `state=done` rev=**2** `[action:completed]` |

两个差异都是目标行为：终态在 Action 完成时就已收敛；本条不再进入恢复集（查询条件是 `state='streaming'`），因此不追加错误 Part，也少一次写入。

### A.6 冗余发布（两处，已复现多次）

1. **`part/tool state=ready` 连发两次**：`prepare_tool_input` 与 `tool_call_finish` 都设 `state: "ready"` 并各自落盘。同 revision、同内容。
2. **`list_messages()` 包含未提交草稿**：实测落盘后 `parts=[]` 但内存投影有内容，客户端会同时从快照和 Mutation 拿到同一个对象。

两者可在后续单独处理，不属于本次「删除冗余字段」。

### A.7 `ask_question` 与 `approval` 的实质差异

两者共用同一套 Interaction 机制，但有两个重要不同：

| | `approval` | `question` |
| --- | --- | --- |
| `question_id` 由谁生成 | 无此字段 | **Session 生成**（Tool 只给 `question` 文本，Session 补 `question:<id>`） |
| `response_schema` | 有（`SESSION_APPROVAL_RESPONSE_SCHEMA`） | **无** |

两者的终止方式一致：只能由用户响应，或随所属 Turn/Session 结束而被取消。均无超时。

> 修订（后续已落地）：本节最初记录的是「Approval 设 7000s 超时、Question 不设」，视为语义不对称。该不对称已被消除——**两者都不再设置超时**，`expires_at` 与 `expired` 终态已从协议中删除。详见 `session-layer-cleanup-plan.md` 的「批次 0」。

回答校验（`SessionInteractions.validate_response`）实测生效：单选给数组立即被拒（`Session Interaction answer must be a string`），选项校验也在。

## 附录 B：已观察但不在本次范围

`SessionAgentMessageState.project_delta` 在每个文本增量重建整条 Message 并 `structuredClone`，长回复下是 O(n²) 拷贝。与本次「删除冗余字段」是不同问题，单独立项。

## 附录 C：可运行的端到端调用示例

下面是一个真实可跑的示例（已运行），它同时给出「一次 Turn 的完整链路」与「缺陷复现」。实现完成后，将两处断言反转即成为 §8.2 要求的验收用例。

```js
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalFileSystem } from "@downcity/city";
import { SessionMessages } from "@downcity/agent/bin/session/SessionMessages.js";
import { SqliteSessionStorage } from "@downcity/agent/bin/session/storage/SqliteSessionStorage.js";

/** 构造一个真实 SQLite 支撑的 SessionMessages 与 mutation 日志。 */
async function create_session(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `downcity-flow-${label}-`));
  const store = new SqliteSessionStorage({
    files: new LocalFileSystem(root),
    session_id: `sess-${label}`,
    agent_id: "demo-agent",
    origin: { type: "chat" },
    database_path: path.join(root, "session.db"),
    database_location: { type: "file" },
    attachments: {},
  });
  const mutations = [];
  const messages = new SessionMessages({
    session_id: `sess-${label}`,
    store,
    attachment_store: store.attachments,
    publish: (mutation) => mutations.push(mutation),
  });
  await messages.initialize();
  return { messages, store, mutations, root };
}

// ---------- 示例 1：一次 Turn 的完整调用链路 ----------
const session = await create_session("turn");

// 调用方：打开本 Turn 的消息
const writer = await session.messages.open_agent_message({ turn_id: "turn-1" });

// 模型流事件逐个进入
await writer.begin_step();
await writer.apply_model_event({ type: "text_start", content_id: "c1" });
await writer.apply_model_event({ type: "text_delta", content_id: "c1", delta: "你好" });
await writer.apply_model_event({ type: "text_finish", content_id: "c1" });

// Tool 调用：开始 → 输入就绪 → 执行结果
await writer.apply_model_event({
  type: "tool_call_start", content_id: "c2", tool_call_id: "call-1", tool_name: "lookup",
});
await writer.apply_model_event({ type: "tool_call_finish", content_id: "c2", input: { q: "x" } });
await writer.prepare_tool_input({
  tool_call_id: "call-1", tool_name: "lookup", input: { q: "x" },
});
await writer.apply_tool_result({
  tool_call_id: "call-1", tool_name: "lookup", succeeded: true, output: { found: true },
});

// 收口
await writer.complete();

// ---------- 示例 2：Action 收口（当前行为） ----------
await session.messages.persist_action({
  action_id: "action-1", action_type: "deploy", turn_id: "turn-1",
  title: "Deploying", status: "running",
});
await session.messages.persist_action({
  action_id: "action-1", action_type: "deploy", turn_id: "turn-1",
  title: "Deployed", status: "completed",
});
```

### C.1 实际观测输出

```text
=== 示例 1：mutation 序列 ===
   message/agent msg=agent:sess-turn:M8btCxGqVhfZb4d7 state=streaming rev=1
   part/text state=streaming part=text:rvtahDX8hvu4RANy rev=1
   delta/text  part=text:rvtahDX8hvu4RANy +"你好"
   part/text state=done      part=text:rvtahDX8hvu4RANy rev=1
   part/tool state=input-streaming part=tool:call-1 rev=1
   part/tool state=ready           part=tool:call-1 rev=1
   part/tool state=ready           part=tool:call-1 rev=1   ← 重复发布
   part/tool state=completed       part=tool:call-1 rev=2
   message/agent msg=agent:sess-turn:M8btCxGqVhfZb4d7 state=done rev=4   ← 收口
=== 落盘后的 Message ===
   state=done  revision=4  parts=[text:done, tool:completed]

=== 示例 2：Action running -> completed ===
   message/agent msg=action-1 state=streaming rev=1
   part/action  state=completed part=action-part:action-1 rev=2
   落盘：  state=streaming revision=2 parts=[action:completed]
   重启后：state=done      revision=3 parts=[action:completed, error:runtime_interrupted]
```

### C.2 输出说明了什么

**两个序列的差别就是缺陷本身。** 示例 1 的第 9 行有一条收口 mutation：

```text
message/agent ... state=done rev=4
```

示例 2 **完全没有这一行**。Action 写完只有 part mutation，Message 停在 `state=streaming`，而 part 已经是 `completed`。两者矛盾，但没有任何机制发现它。

按本设计（§3.1）修正后，同一段代码的输出应当变为：

```text
=== 示例 2：Action running -> completed ===
   ...
   落盘：  state=done  parts=[action:completed]      ← 由 Parts 推导，不再矛盾
   重启后：state=done  parts=[action:completed]      ← 不再追加 error Part
```

验收断言：`persist_action(completed)` 后的 `state === "done"`，且 `initialize()` 后 `parts` 长度不变（无 `runtime_interrupted`）。

### C.3 顺带观察到的两处冗余

1. **重复 Part Mutation**：`part/tool state=ready` 连续发布两次（`prepare_tool_input` 与 `tool_call_finish` 各自触发一次）。同一 `revision`、同一内容，属于可消除的重复发布。
2. **示例 1 的 revision 跳变**：序列中出现 rev=1 → rev=2 → rev=4，说明中间有一个 revision 被消耗在未发布的提交上。见附录 A.3。

## 附录 D：批次 1 已完成内容（供对照）

已落地、未提交：接通 `SESSION_APPROVAL_RESPONSE_SCHEMA`（Shell 与 Tool 审批共用）；删除 `SessionAgentActionPartWriter`、`append_completed_agent_message`、`AgentSessionActionState/Record`、重复注释；合并 `SessionActionEventInput` 到 `SessionActionEvent`；`open_action_part` 收进 `create_standalone_action_message`。

与批次 A 不冲突：A4 会删除 `create_standalone_action_message` 中的 state 条件。
