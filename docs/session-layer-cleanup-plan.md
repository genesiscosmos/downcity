# Session 层代码收敛计划

> 状态：待执行
>
> 适用范围：`packages/agent/src/session`、`packages/agent/src/types/session`
>
> 前置：`session-message-unified-state-prd.md` 的改动已落地（工作区，未提交）。本计划不重复其内容。

## 1. 核心发现：30 个公开方法里 13 个是纯转发

`SessionMessages` 有 30 个公开方法，其中 13 个只做一件事——把调用转发给 `agent_state`：

```ts
async commit_agent_step(message_id, parts) {
  await this.agent_state.commit_step(message_id, parts);        // 仅此
}
async checkpoint_agent_message(message_id) {
  await this.agent_state.checkpoint(message_id);                // 仅此
}
async complete_agent_message(message_id, status, error) {
  await this.agent_state.complete(message_id, status, error);   // 仅此
}
// …另有 10 个同形
```

调用方只有两个（已核实）：

| 调用方 | 用到的转发方法 |
| --- | --- |
| `SessionAgentMessageWriter`（持有 `recorder: SessionMessages`） | `project_agent_delta`、`project_agent_part`、`checkpoint_agent_message`、`commit_agent_parts`、`rollback_agent_projection`、`commit_agent_step`、`complete_agent_message`、`find_streaming_tool` |
| `SessionInteractions`（持有 `messages: SessionMessages`） | `request_interaction`、`resolve_interaction`、`close_interaction`、`list_pending_interactions` |

**这 13 个方法就是这轮开头被指出的「薄封装」。** 它们存在，只是为了让两个协作者穿过 `SessionMessages` 拿到 `agent_state`。结果是每次写操作都走两层，而两层的名字还不一样。

## 2. 批次 0：删除 Interaction 超时（已完成）

由用户决定：Question 与 Approval **都不应设置 `expires_at`**，`ShellApprovalRequest.timeout_ms` 一并删除。

### 2.1 为什么删

Interaction 的终止方式原本有三种：用户响应、等待超时、随 Turn/Session 结束。删掉超时后降到两种，且第二种不再是一个独立的领域路径。一条审批等两个小时再自动失败，对“高风险操作需人裁定”这个场景没有意义：要么等用户，要么随会话结束。

### 2.2 删除链（跨两个包）

| 位置 | 删除内容 |
| --- | --- |
| `SessionInteraction.ts` | `SessionInteractionRequest.expires_at`、`SessionInteractionStatus` 的 `expired`、`SessionExpiredInteractionResult`、`SessionExpireInteractionInput` |
| `SessionInteractions.ts` | `request()` 里的 `setTimeout` + `timer.unref`、`validate_request` 的 `expires_at` 前置校验、`expire()` 整个方法、`finish_pending` 的 `clearTimeout` |
| `SessionInteractions.ts`（types） | `SessionPendingInteractionRuntime.timer` |
| `SessionMessageInteractionWriter.ts` | `expired → "Interaction expired"` 分支 |
| `SessionStorageCodec.ts` | interaction status 枚举校验里的 `expired` |
| `SessionShellApprovalAdapter.ts` | `expires_at` 输出、`expired` 结果映射 |
| `AskQuestionsTool.ts` | `expired` 结果分支 |
| `ShellAction.ts` | `ShellApprovalStatus` 的 `expired`；`ShellSessionStatus` 的 `expired` |
| `ShellApproval.ts` | `ShellApprovalRequest.timeout_ms` |
| `ShellRuntimeOptions.ts` | `default_approval_timeout_ms` |
| `ShellActionRuntimeSupport.ts` | `DEFAULT_APPROVAL_TIMEOUT_MS`、`is_terminal_status` 的 `expired` |
| `HostApprovalRuntime.ts` | `timeout_ms` 参数与透传 |
| `ShellStartActions.ts` / `ShellWriteActions.ts` | 传递 `timeout_ms` |
| `ShellActionShared.ts` | `"Host execution approval expired."` 文案、`status: "expired"` 派生 |
| `ShellTools.ts` | 两处 `approval_status !== "expired"` |
| `AgentInteraction.tsx` + locales | `expired` 展示分支与文案 |
| `approvals.mdx`（中/英） | 生命周期里的 `expired` 说明 |

### 2.3 附带的设计收益

删到只剩下一种终态后，`SessionInteractionCloseInput` 不再需要 `status` 字段——它的唯一职责变成了携带 `reason`：

```ts
/** 关闭 pending Interaction 的输入；终态固定为 cancelled。 */
export interface SessionInteractionCloseInput {
  reason: "turn_stopped" | "session_disposed" | "runtime_interrupted";
}
```

同一原因：`ShellSessionStatus` 的 `expired` 变体也成了死枚举（`derive_exit_status` 只产出 `killed`/`completed`/`failed`），一并删除。`starting` 仍被多处读取，保留。

### 2.4 影响

- **行为变更**：等待审批不再自动超时。原先 2 小时的审批窗口消失，审批要么得到用户响应，要么在 Turn/Session 结束时被标记为 cancelled 并把所属 Tool 标为 failed。
- **协议变更**：`SessionInteractionStatus` 六态 → 五态；`ShellApprovalStatus` 三态 → 二态。属公开协议，需随包版本发布。
- **验证**：三个包重新构建通过，`packages/agent` 75/75，`packages/city` 250/264（两个基线失败），`app/cli` typecheck 通过。

## 3. 九项待改，按风险分四批

### 批次 1：零风险清理（已完成）

> 落地结果见「1.4 实施记录」。以下保留原始分析，其中一条已被实测推翻。

#### 1.1 命名与语义对齐

改了 `state` 语义后漏改的名字，现在会误导读者：

| 现在 | 改为 | 位置 |
| --- | --- | --- |
| `find_streaming_tool` | `find_tool_in_open_message` | `SessionAgentMessageState.ts:266`、`SessionMessages.ts:713`、`SessionMessageInteractionWriter.ts:32,268` |
| `require_streaming_assistant` | `require_open_message` | `SessionMessageInteractionWriter.ts:207` |
| `require_streaming_tool` | `require_open_message_tool` | `SessionMessageInteractionWriter.ts:267` |
| `SessionStreamingToolLocation` | `SessionOpenMessageToolLocation` | `types/session/SessionTool.ts:10` |

#### 1.2 删除失效的 part_id 规则

`normalize_session_user_parts` 生成 `user-text:${index + 1}`，随后 `append_user_message` 无条件覆盖为 `${message_id}:part:${sequence}`。第一条规则没有任何生效路径。

补充证据：`part_id` 在 `message_parts` 中是 `PRIMARY KEY`，所以第二条消息的 `user-text:1` 会直接撞主键。这条规则不只是无用，而且是错的。

#### 1.3 去掉多余读

**每次翻页算全表统计（成立，已改）**：`list_messages` 末尾为填 `total` 调用 `message_stats()`，而它会读 `session_state`、查最新一条消息（带 join）、再算一次 `file_size`。给 Store 加一个只做计数的窄方法。

```ts
// SessionMessages.list_messages：只取计数，不取最新消息与字节数
const total = await this.store.message_count();
```

**每次检查点重读消息（不成立，已保留）**：原判断是「调用方手上已有 `current` 快照，重读是冗余」。实测推翻了它，详见 1.4。

#### 1.4 实施记录

| 项 | 结果 |
| --- | --- |
| 1.1 改名 | 已完成。4 个标识符 + 5 处注释；`packages/agent/scripts/session-interaction-mutation.test.mjs` 直接构造 writer，同步改了 options 键名 |
| 1.2 删死规则 | 已完成，且比原计划更彻底：新增 `SessionUserPartContent`（分配式 `Omit<part_id \| sequence>`），`normalize_session_user_parts` 只返回内容，`normalize_canonical_session_user_parts` 整个函数删除（其职责被 `append_user_message` 吸收），identity 与顺序统一由 `append_user_message` 分配 |
| 1.3 `list_messages` 计数 | 已完成。`SessionStorage` 新增 `message_count()`，只查 `session_state` 一列 |
| 1.3 `persist_snapshot` 重读 | **已保留**。原判断错误，见下 |

**被实测推翻的判断**。我原本认为 `persist_snapshot` 开头那次 `read_message` 是冗余重读，改用调用方传入的 `current`。写探针实测后推翻：

```text
投影后已发布: message/agent, part/text, delta/text

原实现（diff 基线 = DB）：     checkpoint 额外发布（无）  落盘 parts: text:streaming:"部分文本"   ← 正确
探针版（diff 基线 = 内存快照）：checkpoint 额外发布（无）  落盘 parts: （空）                    ← 静默丢数据
```

原因是两个 diff 服务于不同目的，不能合并：

| diff | 基线 | 用途 |
| --- | --- | --- |
| `persist_snapshot` 的 `changed_parts` | **DB** | 告诉存储层要 upsert 哪些 part 行 |
| `accept_message` 的 `project_message_change` | **内存缓存** | 决定向订阅方发布什么 |

「发布什么」由第二个 diff 决定，与那次重读无关；而那次重读是**存储写入的必要输入**。换成内存基线后 `changed_parts` 算成空集，part 行不会被写，数据静默丢失且不报错。

教训：这两层的 diff 看起来重复，实际一个是「持久化」事实、一个是「订阅」事实。任何合并它们的尝试都会失掉一层语义。

### 批次 2：`Session.ts` 的 Action 字面量（已撤销）

原判断：删掉 `emit_action_event` 后，同一段七字段对象字面量出现四次，应把「构造并提交一条 Action」收成助手。

**核实后撤销。** 三个 fork 调用点共享的只有 `action_id`（一个变量）与 `action_type: "history-fork"`（一个字面量），差异是 `title` / `description` / `status`。

```ts
// Session.ts:492 / 515 / 524 —— 共享部分只有前两行
await this.session_messages.persist_action({
  action_id,                              // 同一个变量
  action_type: "history-fork",            // 同一个字面量
  title: "Forking session messages",      // ↓ 各自不同
  description: `Preparing ${...} messages for the new session.`,
  status: "running",
});
```

而那个拟议中的助手——入参五字段、出参同样五字段——**就是被删掉的 `emit_action_event`**。批次 1 删它有理由（合并类型后它变成纯透传），批次 2 再加回来是循环。

我把「共享字段名」误计成了「重复代码」。字段名一致是 API 形状，不是重复。

#### 2.1 顺便发现的一个真问题（独立于本计划）

`action_type` 不是精确协议。desktop 用子串匹配做展示分派：

```ts
// app/desktop/.../agent_activity_presentation.ts:128
function resolve_agent_action_visual_kind(action_type: string): AgentActionVisualKind {
  const normalized = action_type.toLowerCase();
  if (normalized.includes("fork")) return "fork";
  if (normalized.includes("compact")) return "compaction";
  if (normalized.includes("command")) return "command";
  return "generic";
}
```

所以把 `"history-fork"` 提成共享常量治不了任何东西；真正脆的是这个子串匹配本身（任何含 `fork` 的 action_type 都会得到 fork 视觉）。若希望 action_type 成为真正的契约，需要双方改成精确枚举——那是独立议题。

### 批次 3：消掉转发方法（已探针验证，前提需修正）

原判断：`SessionMessages` 有 13 个纯转发方法，让协作者直接持有 `agent_state` 即可删除。

**探针结果：前提不对。** 逐个体检查后：

| 分类 | 数量 | 说明 |
| --- | --- | --- |
| 真透传 | **12** | `project_agent_*`、`checkpoint_agent_message`、`commit_agent_parts`、`rollback_agent_projection`、`commit_agent_step`、`list_pending_interactions`、`request/resolve/close_interaction`；其中 `find_tool_in_open_message` **已无调用者** |
| 非透传 | **1** | `complete_agent_message`：它先释放 `open_writer` 持有，再委派 |

但 Writer 的真实依赖不只有这 12 个。它调用 `this.recorder.*` 共 11 处，其中两处**不在**那 13 个里面：

```ts
// SessionAgentMessageWriter
private current_message(): SessionAgentMessage {
  const message = this.recorder.get_message(this.message_id);   // ← 缓存读取
  ...
}
async close_serialized(...) {
  await this.recorder.complete_agent_message(...);              // ← 持有释放
}
```

而 `get_message` 读的是 `messages_by_id`（`SessionMessages` 的缓存），`complete_agent_message` 释放的是 `open_writer`（也是 `SessionMessages` 的持有关系）。

所以若只把 Writer 的依赖从 `SessionMessages` 改成 `agent_state`，它反而要从两个对象取东西——**比现状更绕**。真正的耦合不在转发层，而在：

1. 消息缓存（`messages_by_id`）归谁；
2. 持有关系（`open_writer`）归谁。

#### 结论：批次 3 与 4.1 应合并为一次重构

单独删转发没有收益，正确的做法是先把“消息缓存 + Mutation 发布”抽成独立协作者，再让三方共享它：

```ts
type SessionMessageCache = {
  /** 读取一条已缓存的 Agent Message。 */
  get(message_id: string): SessionMessage | undefined;
  /** 在接受已持久化快照时更新缓存，并按需发布 Mutation。 */
  accept(message: SessionMessage, publish_mutation?: boolean): void;
  /** 当前被未收口 writer 持有的 Message 标识。 */
  held_message_id(): string | undefined;
};
```

这样才成立：

- Writer 持有 `(agent_state, cache)`，不再依赖 `SessionMessages`；
- 12 个透传方法可删；
- `complete_agent_message` 的释放动作消失——持有关系改由 Writer 自己的 `closed` 标志回答（同时也消除“同一事实存两份”的问题）；
- 构造函数里的四个回指闭包（4.1）随之消失。

**这是一次真实的结构重构，不是删除批次。** 动手前需确认 `SessionMessageCache` 的职责边界，并重新评估测试影响（`SessionAgentMessageState` 的 options、`SessionInteractions` 的构造、`session-interaction-mutation.test.mjs` 的直接构造都会变）。

```ts
// 目标形态（待评审）：Writer 不再经 SessionMessages 转手
async open_agent_message(input: OpenSessionAgentMessageInput): Promise<SessionAgentMessageWriter> {
  const writer = new SessionAgentMessageWriter(this.agent_state, message_id);
  ...
}
```

### 批次 4：结构收敛（需先评审）

#### 4.1 构造函数里的回指闭包（已并入批次 3）

见批次 3 结论：四个回指闭包与 12 个转发方法是同一个耦合的两面，应在同一次重构中处理。

`SessionMessages` 构造 `agent_state` 时传入四个指回 `this` 的闭包，与 PRD §2.5 批评 `SessionMessageInteractionWriter` 的那处是同一种形状：

```ts
this.agent_state = new SessionAgentMessageState({
  session_id: this.session_id,
  store: this.store,
  list_messages: () => this.messages_by_id.values(),
  is_held_by_writer: (message_id) => this.is_held_by_writer(message_id),
  accept_message: (message, publish_mutation) => this.accept_message(message, publish_mutation),
  project_mutation: (mutation, message) => this.accept_mutation(mutation, message),
});
```

`accept_message` / `project_mutation` 的唯一职责是「落盘后写缓存 + 发 Mutation」，这是 `SessionMessages` 的领域职责，不该以闭包形式外借。方向：把「消息缓存 + Mutation 发布」抽成一个独立协作者，双方各持一份引用，而不是互相穿透。

此项与批次 3 强相关，建议合并设计。

#### 4.2 `validate_request` 里的业务校验

`SessionInteractions.validate_request` 内含整段 `if (request.type === "question")` 的逐字段校验（`questions` / `options` / 唯一性）。通用交互运行时不该知道 Question 的 payload 形状。

方向：每个 Interaction 类型自带校验函数，运行时只校验通用信封（`interaction_id` / `turn_id` / `source` / 过期）。

```ts
/** 单个 Interaction 类型的请求校验。 */
interface SessionInteractionTypeValidator {
  /** 该类型名。 */
  type: string;
  /** 校验 payload；失败抛错。 */
  validate_request(request: SessionInteractionRequest): void;
  /** 校验响应 payload 与请求的一致性。 */
  validate_response(request: SessionInteractionRequest, response: SessionInteractionResponse): void;
}
```

这需要一张注册表。属于新概念，应先写进 PRD 再动手。
## 4. 需要先回答的问题

**4.1 `state` 是否删列。** 本计划不含此项。当前状态是「值由一处推导、但仍落库」，语义已统一、存储仍冗余。删列前需确认没有外部直接读 `messages` 表（目前已知 desktop / ui / cli 都经 SDK 读取，未直接查库）。

**4.2 Interaction 的终止语义（已解决）。** 见「批次 0」：两者都不再设置超时。

**4.3 两处冗余发布的归属。** `part/tool state=ready` 连发两次（`prepare_tool_input` 与 `tool_call_finish` 各自落盘），以及 `list_messages()` 会返回未提交的草稿。两者都可单独修，但不属于本计划。

## 5. 验证方式

批次 1–3 均为行为不变，验收方式统一：

```bash
pnpm -C packages/type build && pnpm -C packages/agent build && pnpm -C packages/city build
pnpm -C packages/agent typecheck && pnpm -C packages/agent test   # 75/75
pnpm -C packages/city typecheck
pnpm -C packages/city test                                        # 250/264，两个基线失败
```

批次 3 需要额外确认写路径无回归：`packages/city/test/session-messages.test.mjs`（覆盖流式、检查点、Tool gate、恢复）与 `session-interaction-*.test.mjs` 必须全绿。

**已知基线失败（与本计划无关，已核实）**：

- `ImagePlugin image_result stores remote images locally`
- `running session approval mode changes stay queued until the next Session step`
- 全仓库 `pnpm typecheck`：`templates/ui` 引用 `@downcity/ui` 未导出的 `ChatInputEditor`

## 6. 建议顺序

```mermaid
flowchart LR
    A[批次 0 · 已完成<br/>删 Interaction 超时] --> B[批次 1 · 已完成<br/>零风险清理]
    B --> C[批次 2 · 已撤销<br/>经核实是循环]
    C --> D[批次 3 · 待验证<br/>删 13 个转发]
    D --> E[批次 4<br/>结构收敛]
    E --> F[待定<br/>state 删列]
```

批次 2 撤销后的教训适用于批次 3：本计划前两项都被核实推翻（1.3a 的重读、整个批次 2），说明「看起来重复」的判断不能直接采信。批次 3 动手前应先对其中一个转发方法做与 1.4 相同的探针验证。

批次 1 与 2 可以立刻做，互不干扰，各自可单独回滚。批次 3 是收益最大的一项——它同时解决「薄封装」和「887 行神对象」两个问题，且行为不变。批次 4 涉及新概念，应先写设计。
