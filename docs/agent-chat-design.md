# Session 角色与 Workspace 能力重设计

> 状态：设计稿，待实施
>
> 适用范围：`@downcity/agent`、`@downcity/city` 调用点、`@downcity/powers`、`private/apps/desktop`、`packages/cli`、homepage `agent-sdk-docs`
>
> 更新时间：2026-10-08
>
> 关联输入：`docs/city-sdk-call-design.md`、`docs/city-tool-design.md`、`docs/engineering-design-standard.md`

## 1. 产品意图

Agent 是主体，不是一个需要用户组装的执行框架。用户对它的期待是「像对一个同事说话」：说事、得到回应、能插话、能追问。这决定了两件事。

第一，**用户不该管理会话**。他不需要判断「这件事该不该新开一段对话」「该在哪个目录里做」。

第二，**Agent 自己就有一条会话**。它就是 Agent 的脸：用户通过它说话，Agent 用它在别处办事并始终掌握那些事。今天这段对话由宿主拼装（Desktop 用自己的 `agent_main_sessions` 记住「哪个 Agent 对应哪个 Session」），换个渠道或进程就断了。

同时修正两处范畴错误：

- **Workspace 不是 Session 的身份。** 现在 `workspace_id` 落盘并在 `get()` 时强校验相等，等于拿执行参数当身份——换个目录就得新建会话。
- **Workspace 的解析不是 Agent 的职责。** 谁持有 Workspace，谁负责把标识还原成实例。

## 2. 心智模型

### 2.1 只有 Session 一个概念

Agent 自己那条会话是 Session，Agent 派出去干的活是 Session，任务触发的是 Session，群聊里的是 Session。它们**是同一种东西**，共用同一套机制、同一套能力，包括工作区能力。

角色由 `origin.type` 表达。`origin` 本来就同时承担「这是哪类会话」与「它存在哪个分区」，`group` 已经在用同一机制，因此不需要新增字段、索引或概念。

| 角色 | `origin.type` | `session_id` | 说明 |
| --- | --- | --- | --- |
| Agent 自己的会话 | `agent` | **Agent 的 id** | 它就是 Agent，一个 Agent 至多一条 |
| 工作会话 | `work` | 生成的 id | 现在的主流会话 |
| 任务会话 | `task` | 生成的 id | Task Plugin 触发 |
| 群聊会话 | `group` | 生成的 id | Group 成员会话 |

**Agent 那条会话的 id 就是 Agent 的 id**：会话由它属于谁来标识，不需要人造常量。取用自解释：`agent.sessions.get(agent.id, "agent")`。

`work` 取代现在的默认类型 `chat`。它是一个干净的主类型名：这段会话的存在意义就是干活。

### 2.2 Agent 自己的会话也是 Session

底层仍共用 Session 的 `set/get`、消息、审批和工具能力。Desktop 主会话的目录由宿主固定为 `~/.downcity/agents/<agent_id>/main`，用于持续对话、私有文件和派发工作；它不绑定用户的项目 Workspace，也不进入 Works 项目列表。

工作会话使用用户明确指定的项目 Workspace。主会话的私有目录不能成为项目工作默认目录。主会话首次创建通过 `self({ workspace })` 注入专属目录，恢复时由宿主用 `get(agent_id, "agent", { workspace })` 注入；`self()` 不修改已存在会话的目录。

### 2.3 Workspace 是宿主注入的执行资源

Workspace 的位置由所有权决定，不由调用便利性决定。

| 问题 | 归属 |
| --- | --- |
| 有哪些 Workspace | **City**：持有 registry |
| 把实例注入 Session | **宿主**：在 `create` / `get` / `set` 时传入 |
| 记住「上次在哪个目录」 | **Session**：只持久化 `workspace_id` |
| 把标识还原成实例 | **宿主**：Session 不做，Agent 也不做 |

四条规则：

**实例不落盘。** `session_state` 只存 `workspace_id`，用于列表分组与展示。

**恢复由宿主完成。** `get()` 不带 Workspace 时不尝试还原，只读出 `workspace_id`。

**解析失败不是错误。** 历史会话指向本次宿主没有提供的目录属于正常情况：该会话没有项目上下文，没有文件工具与 Shell，但纯模型对话仍可用。

**Agent 不参与。** `AgentOptions` 没有 `resolve_workspace`，Agent 不持有 registry，也不回查 City。它只保留 `workspace` 作为「新会话默认目录」，不参与恢复。`CityRuntime` 保持现状——它刻意不含 Workspace 查询，因为「Workspace 由调用方在创建时显式传入」。

### 2.4 一对读写手柄

`set` 与 `get` 是 Session 上唯一的配置读写入口，语义对称。

| | 写 | 读 |
| --- | --- | --- |
| 持久化字段 | `set({ ... })` | `get("<field>")` |
| 运行时实例 | `set({ model })`、`set({ workspace })` | `get("model")`、`get("workspace")` |

`set` 接收运行时对象，把可序列化部分落盘，把实例留在内存。`get("workspace_id")` 与 `get("workspace")` 是两件事，互不推导。

## 3. 用户场景

### 3.1 眼前的小事

用户随口问「这个 `SessionMessages` 是干嘛的」。回答在 Agent 自己的会话里说完，不产生第二条会话，用户不该意识到「会话」这个词存在。紧接着「帮我把这个方法名统一成 snake_case」——一轮的事，Agent 直接做完。

这要求 Agent 自己的那条会话**本身能干活**，不是转发台。

### 3.2 事比一轮大

用户说「CI 上挂了三个测试，帮我修了」。原地跑会占住界面十几分钟。理想反应是回一句「我去看，修完说」，对话立刻能接下一句。用户接着说「顺便把 README 的安装步骤从 npm 改成 pnpm」，与刚才那件事同时在跑。

### 3.3 回到对话问进展

二十分钟后，用户问「那个测试修得怎么样了」。Agent 答得上来——它手上有一份当前状态。接着问「具体改了哪几个文件」，它答不了，但能拉一下那条活的记录再答。

### 3.4 活遇到人

修测试的会话想跑 `git reset --hard`。用户正在对话里等着，看到「它想 reset 到上一个提交，会丢掉你现在的改动，要放行吗」，然后说「别 reset，用 stash」。

这条最硬：**答复必须真的送到那条会话手里**。若审批只能在那条会话自己身上回答，用户就得跳进去，「用户永远不必跳进去」这句话就假了。

### 3.5 换仓库

用户说「另一个仓库里也有这个问题」。他期望的是同一个 Agent、同一段对话换个目录继续。

### 3.6 换渠道、重启

昨晚在桌面端说话。今天在 Telegram 上发「昨天那个测试修完了吗」，应该是同一个 Agent、同一段对话答他。活跑到一半进程重启，再打开时那段对话仍然知道它存在过。

### 3.7 人不在场

早上 9 点定时任务触发，Agent 自己开工查昨天的日志。这件事和用户派出去的活出现在同一个地方。

## 4. 公开 API

### 4.1 Agent

```ts
export interface Agent {
  /** Agent 自己的会话；不存在时创建。它就是 Agent。 */
  session(input?: AgentSessionInput): Promise<AgentSession>;

  /** 全部 Session 的操作入口。 */
  readonly sessions: AgentSessionCollection;
}
```

```ts
export interface AgentSessionInput {
  /** 首次创建时注入的目录；省略时使用 `AgentOptions.workspace`，两者都无则没有项目上下文。 */
  workspace?: WorkspaceRuntime;
}
```

`AgentOptions` 回到 `Identity + Model + Instruction + Tools + Sessions`，只增加一个「新会话默认目录」：

```ts
export interface AgentOptions {
  /** 稳定标识；同时是 Agent 自己那条会话的 session_id 与数据分区键。 */
  id: string;

  /** 用户可见名称；缺省回退到 id。 */
  name?: string;

  /** 一句话能力描述，供展示与 Group 调度。 */
  description?: string;

  /** 静态基础指令；缺省使用包内 core prompt。 */
  instruction?: string | string[];

  /** 默认模型实例；Session 可覆盖。 */
  model?: ModelClient;

  /**
   * 新建 Session 时注入的默认目录。
   *
   * 关键点（中文）
   * - 不是绑定：单个 Session 可用 `set({ workspace })` 换掉。
   * - 不参与恢复：历史会话的目录由宿主在 `get()` 时注入。
   */
  workspace?: WorkspaceRuntime;

  /** Agent 自有的自定义工具。 */
  tools?: Record<string, Tool>;

  /** Agent 自有的检查点处理器。 */
  hooks?: ToolHookSet;

  /** 自定义 Session 类。 */
  session_class?: AgentSessionConstructor;

  /** 描述「怎么和模型说话」，全部 Session 共享。 */
  session_composer?: SessionComposer;
}
```

**删除 `resolve_workspace`**：解析是持有 Workspace 一方的职责，不是 Agent 的。`workspace` 保留为「新会话默认目录」。

### 4.2 AgentSessionCollection

```ts
export interface AgentSessionCollection {
  /** 返回 Agent 自己的会话；不存在时创建。 */
  self(options?: AgentGetSessionOptions): Promise<AgentSession>;

  /** 新建一条工作会话。 */
  create(options?: AgentCreateSessionOptions): Promise<AgentSession>;

  /** 恢复一条会话。 */
  get(session_id: string, origin_type?: string, options?: AgentGetSessionOptions): Promise<AgentSession>;

  /** 列出会话。默认只看 `work` 分区。 */
  list(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage>;

  // archive / archived / clean_archive / runtime / remove / clear_messages / release 语义不变。
}
```

```ts
export interface AgentCreateSessionOptions {
  /** 会话角色；省略时为 `work`。 */
  origin?: SessionOrigin;

  /**
   * 本次注入的 Workspace 实例。
   *
   * 省略时该会话没有项目上下文：没有文件工具与 Shell，纯模型对话仍可用。
   */
  workspace?: WorkspaceRuntime;
}

export interface AgentGetSessionOptions {
  /**
   * 本次恢复注入的 Workspace 实例。
   *
   * 与持久化值不一致不是错误：以传入值为准，语义等同 `set({ workspace })`。
   * 省略时沿用内存实例；内存也没有则该会话没有项目上下文。
   */
  workspace?: WorkspaceRuntime;
}
```

`origin_type` 默认值从 `"chat"` 改为 `"work"`；角色常量从 `@downcity/type` 导出（`SESSION_ORIGIN_TYPE_AGENT` / `SESSION_ORIGIN_TYPE_WORK`）。

### 4.3 Session

```ts
export interface AgentSession {
  /** 写入持久化配置；三个字段共用这一个入口。 */
  set(input: AgentSessionSetInput, options?: AgentSessionSetOptions): Promise<void>;

  /** 读取状态；持久化字段与运行时实例共用这一个入口。 */
  get<K extends AgentSessionStateKey>(key: K): AgentSessionStateValues[K];

  // 删除：`workspace_id` 属性、`get_workspace()`、`set_workspace()`、`config` 属性。
}
```

```ts
export interface AgentSessionSetInput {
  /** 运行时模型实例。 */
  model?: ModelClient;

  /** 安全策略。 */
  security?: AgentSessionSecurityConfig;

  /**
   * 执行目录。
   *
   * 关键点（中文）
   * - 实例由宿主注入；同时把它的 `id` 写入持久化配置。
   * - 传 `null` 表示脱离项目上下文。
   * - 不迁移已有消息、附件与工具结果；它们属于发生时的目录。
   * - 执行中的 Turn 沿用旧目录，从下一 Step 检查点起生效。
   */
  workspace?: WorkspaceRuntime | null;
}
```

### 4.4 session.get() 的键

键名即语义。持久化列跨进程可用，运行时实例只在当前进程可用。

| key | 值 | 来源 |
| --- | --- | --- |
| `workspace` | `WorkspaceRuntime \| undefined` | 运行时实例（宿主注入） |
| `workspace_id` | `string \| undefined` | 持久化 |
| `model` | `ModelClient \| undefined` | 运行时实例 |
| `model_label` | `string \| undefined` | 持久化 |
| `model_context_window` | `number \| undefined` | 由实例派生 |
| `approval_mode` | `SessionApprovalMode` | 持久化 |
| `title` | `string \| undefined` | 持久化 |
| `timezone` | `string` | 持久化 |
| `created_at` | `number` | 持久化 |
| `updated_at` | `number \| undefined` | 持久化 |

新增状态只扩展这张表，不新增 API。

### 4.5 远程 Session

`RemoteAgentSession` 只能读到可序列化键（`workspace_id`、`model_label`、`approval_mode`、`title`、`timezone`、`created_at`、`updated_at`）。实例类键（`workspace`、`model`）在远程边界不成立，远程 `get()` 不接受它们。

## 5. 调用方式

### 5.1 最小链路

```ts
const agent = new Agent({ id: "coder", model, workspace });

// 取 Agent 自己那条会话；不存在则创建
const session = await agent.session();

const turn = await session.prompt({ query: "这个仓库结构怎么样" });
const result = await turn.finished;

session.messages();      // 读历史
session.subscribe(fn);   // 订变动
session.origin;          // { type: "agent" }
```

它没有专属方法：`prompt` / `messages` / `subscribe` / `stop` / `respond` / `status` 就是 Session 的原有接口，不存在额外的对话层。

### 5.2 读写配置

```ts
await session.set({ model, security, workspace });   // 写
session.get("workspace");                            // 运行时实例
session.get("workspace_id");                         // 持久化标识
session.get("model_label");
session.get("title");
```

`get` 是同步只读，不解析也不落盘。实例类键（`workspace`、`model`）只在当前进程有效；持久化键跨进程可用。

### 5.3 角色与分区

```ts
const work = await agent.sessions.create({ workspace });            // work（默认）
const task = await agent.sessions.create({ origin: { type: "task" } });

agent.sessions.list();                         // 默认只列 work
agent.sessions.get(work.id, "work");
agent.sessions.get(agent.id, "agent");         // Agent 自己那条，id 就是 agent id
```

### 5.4 目录由宿主注入

Session 不还原 Workspace：`get()` 只接受注入。这是最容易踩错的一点。

```ts
// 跨进程重开，不注入：没有项目上下文，但 id 与历史仍在
const without = await agent.sessions.get(session_id, "work");
without.get("workspace");      // undefined
without.get("workspace_id");   // "repo-a"

// 注入：宿主把实例交给会话
const injected = await agent.sessions.get(session_id, "work", { workspace: repo });
injected.get("workspace");     // repo
```

宿主自己持有 Workspace registry，因此只有它能回答「现在有哪些目录可用」。Desktop 与 CLI 都是这么调的：先解析出实例，再作为 `get()` 参数传入。

`new Agent({ workspace })` 只是**新会话的默认目录**，恢复时不生效：否则会用默认值顶替持久化值，变成一次静默换目录。内部用 `creating` 标志区分两条路径。

### 5.5 模型侧安排活

Agent 主会话与 Channel 会话提供一个 `session` 工具，通过 `action` 选择动作，`args` 传入参数。Work 会话不注入该工具。

```ts
// 模型在 Agent 会话里收到「CI 挂了三个测试，帮我修了」时：
// session({ action: "start", args: { workspace_id: "project-id", query: "修 packages/agent 下挂掉的三个测试", title: "修 CI" } })
// → { session_id: "session-..." }   对话立刻空闲

// 用户问「那个测试修得怎么样了」：
// session({ action: "check" })                          → 全部会话与状态
// session({ action: "check", args: { session_id } })    → 某条的详细进展

// 某条会话在等审批时：
// session({ action: "reply", args: { session_id, interaction_id, outcome, payload } })
```

`session` 的 `start` 动作必须传入项目 `workspace_id`，由宿主的 `AgentOptions.resolve_work_workspace` 解析并校验。禁止继承主会话的 main 目录；Desktop 仅接受用户项目 Repository 中的目标。

## 6. 模型侧能力

主会话与 Channel 会话通过单一 `session` 工具协调工作。调用 `session({})` 返回动作说明与输入 Schema，指定 action 后严格校验对应的 args。

| action | 干什么 |
| --- | --- |
| `start` | 开一条工作会话并交给它任务 |
| `check` | 列出会话及状态；带 `session_id` 读取详细进展 |
| `reply` | 答复某条会话等待的审批或提问 |
| `stop` | 停止某条工作会话 |

工具通过 Agent 注入的 `SessionWork` 协议调用运行时，不从 `ToolCallContext` 回查 Agent 或 Session。工具自带 description，动作索引按需返回，无需注入额外 instruction。

注入依据是会话来源：Agent 主会话与 `origin.type === "channel"` 的会话获得该工具，Work 会话不能递归派发。

`session` 的 `start` 动作不读取 `ToolCallContext.workspace`。其目标项目来自显式 `workspace_id`，宿主负责解析实例；Agent 不回查 City registry。

### 6.1 工具与 Power 怎么读会话状态

- **工具**：`ToolCallContext` 继续携带需要的那几个冻结值（`workspace`、`workspace_env`），它在 Turn 开始时成形，不随后续 `set` 变化。
- **Power**：`SessionPort` 增加 `get(key)`，并把 `get_model()` 收进去。

## 7. 生命周期与失败语义

| 情形 | 行为 |
| --- | --- |
| 并发取用 Agent 自己的会话 | 单飞：同一进程内只创建一条 |
| 它被归档或删除 | 下一次取用时重建；集合不维护额外索引 |
| `get()` 未注入 Workspace | 该会话没有项目上下文；`get("workspace_id")` 仍可读，`get("workspace")` 为空 |
| 持久化目录本次不提供 | 同上，不抛错 |
| `set({ workspace })` 时有 Turn 在跑 | 生效于下一 Step 检查点；当前 Turn 沿用旧值，与 `set({ model })` 一致 |
| `session.start` 后立即 `session.stop` | 排队输入被取消，状态记 `stopped`，与用户叫停可区分 |
| `session.reply` 目标 Interaction 已失效 | 返回明确失败，由模型转述给用户，不静默丢弃 |

## 8. 不变量

1. 一个 Agent 至多一条 `origin.type === "agent"` 的会话，其 `session_id` 等于 Agent 的 `id`。
2. 它是普通 Session，除角色、工具集合与固定存取入口外没有特殊行为。
3. `session_*` 工具只在 `origin.type === "agent"` 的会话上下文中存在。
4. Workspace 不是 Session 的身份。切换目录不改变 Session 标识、历史与附件归属。
5. Session 不解析 Workspace：`workspace_id` 是索引，实例一律由宿主注入。
6. Agent 不持有 Workspace registry，不参与解析。
7. `origin` 仍是唯一的分区与分类事实源；不新增并行索引。

## 9. 存储

不改 schema。

- `session_state.workspace_id` 保留，语义为「上次使用的目录」，不用于还原实例。
- Agent 自己的会话落盘为 `sessions/agent/<agent_id>/`（沿用现有 `sessions/<origin_type>/<session_id>/` 规则）。
- `work` 取代 `chat` 后，新会话落在 `sessions/work/<session_id>/`。
- 不做旧数据迁移；既有 `chat` 分区按新类型名读取（见第 10 节）。

## 10. 非目标

- 不做结论自动回流（推送）。当前是拉模式。
- 不改 Desktop 与 CLI 的会话选择启发式。本设计只提供能力。
- 不允许会话再派生会话。

## 11. 待确认

1. **`chat` 到 `work` 的旧数据如何处理。** 现有用户目录里已有 `sessions/chat/` 分区。选项：不迁移、重命名目录、或读取时兼容。这决定是否需要一次性迁移脚本。
2. **`session.config` 是否一并收进 `get()`。** 它与 `get("model")` / `get("model_label")` 重复。建议删除，但改动面超出本次范围。
3. **messenger 入站会话的类型。** 它带 `channel`、`chat_id` 元数据，语义上是「外部聊天」。是并入 `work`，还是保留独立类型。

## 12. homepage 文档

- 新增「Agent 会话」一页：`agent.session()`、角色模型、与其他 Session 的一致规则。
- `sessions/session-management.mdx`：`create` / `get` 的 `workspace` 语义改为「宿主注入」，补 `set` / `get`。
- `sessions/metadata-and-storage.mdx`：补角色分区与 `workspace_id` 的索引语义。
- `api-reference/agent-class.mdx`、`api-reference/session-types.mdx`：补 `set` / `get`，删 `get_workspace()` / `set_workspace()`。

## 13. 验收

| 场景 | 验收点 |
| --- | --- |
| 3.1 眼前的小事 | 一轮问答不产生第二条 Session |
| 3.2 事比一轮大 | 提交后对话空闲；第二次提交不被前一件事阻塞 |
| 3.3 问进展 | 模型能列出全部会话及其状态；细节需要一次 `session_check` |
| 3.4 活遇到人 | 用户在 Agent 会话上 `respond()`，答复送达目标 Session 并使其继续执行 |
| 3.5 换仓库 | 同一条 Session 换目录后继续工作，`session_id` 不变 |
| 3.6 换渠道、重启 | 新进程取到同一条会话与同一份历史 |
| 3.7 人不在场 | 任务会话与派出的活出现在同一份 `list()` |

结构性检查：派出的会话上下文里不存在 `session_*` 工具；并发取用只产生一条 Agent 会话；`get("workspace_id")` 在未注入实例时仍可读而 `get("workspace")` 为空；`set({ workspace })` 在 Turn 执行期间不改变该 Turn 的目录。
