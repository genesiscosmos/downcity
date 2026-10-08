# Agent Chat 与 Session Workspace 解绑设计

> 状态：设计稿，待实施
>
> 适用范围：`@downcity/agent`、`@downcity/city` 调用点、homepage `agent-sdk-docs`
>
> 更新时间：2026-10-05
>
> 关联输入：`docs/city-sdk-call-design.md`、`docs/city-tool-design.md`、`docs/engineering-design-standard.md`

## 1. 产品意图

Agent 是主体，不是一个需要用户组装的执行框架。用户对它的期待是「像对一个同事说话」：说事、得到回应、能插话、能追问。这一条决定了两件事。

第一，**用户不该管理会话**。他不需要判断「这件事该不该新开一段对话」「该在哪个目录里做」。这些是 Agent 自己的事。

第二，**Agent 需要一个属于它自己的对话**。它就是 Agent 的脸：用户通过它说话；Agent 用它在别处办事并始终掌握那些事。今天这段对话由宿主拼装（Desktop 用自己的 `agent_main_sessions` 记住「哪个 Agent 对应哪个 Session」），因此换个渠道、换个进程就断了，桌面端和 CLI 还各有一套「最近会话」的猜测规则。

本设计把这段对话收进 Agent 本身，并顺带修正一处范畴错误：**Workspace 是执行资源，不是 Session 的身份**。现在 `workspace_id` 落盘并在 `get()` 时强校验相等，等于拿执行参数当身份——换个目录就得新建会话。改成「会话的当前目录」之后，在会话中切换 Workspace 成为自然行为，而不是一个新能力。

## 2. 用户场景

### 2.1 眼前的小事

用户在改一个文件，随口问「这个 `SessionMessages` 是干嘛的」。回答在当前对话里说完，不产生第二条会话，用户不该意识到「会话」这个词存在。紧接着「帮我把这个方法名统一成 snake_case」——一轮的事，Agent 直接做完。

这要求 Agent 自己的那段对话**本身能干活**，不是转发台。

### 2.2 事比一轮大

用户说「CI 上挂了三个测试，帮我修了」。原地跑会占住界面十几分钟。

理想反应是回一句「我去看，修完说」，对话立刻能接下一句。用户接着说「顺便把 README 的安装步骤从 npm 改成 pnpm」，与刚才那件事同时在跑，界面上不出现「正在执行，请稍候」。

### 2.3 回到对话问进展

二十分钟后，用户在同一段对话里问「那个测试修得怎么样了」。Agent 答得上来——它手上有一份当前状态：哪些活在跑、哪些完了、哪些卡住。

接着问「具体改了哪几个文件」，它答不了，因为它没背下活的内容。但它能拉一下那条活的记录再答。

### 2.4 活遇到人

修测试的那条会话想跑 `git reset --hard`。用户正在对话里等着，看到的是「它想 reset 到上一个提交，会丢掉你现在的改动，要放行吗」，然后说「别 reset，用 stash」。

这条最硬：**用户的答复必须真的送到那条会话手里**。如果审批只能在那条会话自己身上回答，用户就得跳进去，「用户永远不必跳进去」这句话就假了。

### 2.5 活干完了

结论自己回到对话，用户不需要想起来去问。回来的东西带「我不确定的地方」，而不是一句「已完成」。

### 2.6 活干砸了

修到一半发现 CI 环境缺依赖。用户问「怎么样了」，得到的是「卡在这儿了：`pnpm install` 在 CI 上拉不到私有包」。用户说「那个包在 npmrc 里配了 token」，这句话回到那条会话继续。

### 2.7 换仓库

用户说「另一个仓库里也有这个问题」。他期望的是同一个 Agent、同一段对话换个目录继续，而不是「请新建一个会话并选择 Workspace」。

### 2.8 换渠道、重启

昨晚在桌面端说话。今天在 Telegram 上发「昨天那个测试修完了吗」，应该是同一个 Agent、同一段对话答他。活跑到一半进程重启，再打开时那段对话仍然知道它存在过。

### 2.9 人不在场

早上 9 点定时任务触发，Agent 自己开工查昨天的日志。这件事和用户派出去的活出现在同一个地方。

### 2.10 听起来像活，其实是问句

「如果我把这个缓存删了，会有什么问题」是一个问题，不是一件活。判据由 Agent 自己判断，不靠用户换措辞。

## 3. 心智模型

只有三个范畴，全部是既有的。

| 范畴 | 一句话 | 本次 |
| --- | --- | --- |
| Agent | 主体，有一段属于它自己的对话 | 新增 `chat()` |
| Session | 一段持续交互：排队、Turn、消息、审批 | 去掉 Workspace 强绑定 |
| AgentSessions | Session 的唯一集合与事实源 | 新增主对话识别；去掉归属校验 |

加一个**面向**，不是新对象：**chat 是 Agent 自己那段 Session 的对话面**。它暴露 `send` / `messages` / `subscribe`，与 Session 的同名能力一一对应，没有新语义。

```text
Agent
├── chat          →  Agent 自己那段 Session（origin.type = "main"）
└── sessions      →  全部 Session，含 chat 与它派出去的活
```

「哪一条是 chat」用既有的 `origin.type = "main"` 表达，并以固定 `session_id = "main"` 落盘：`origin` 本来就同时承担「这是哪一类会话」与「它存在哪个分区」，`task`、`group` 已经在用同一机制。固定标识让定位是确定性的，不需要扫描分区或维护索引；重启后照样找得到，被归档或删掉之后下次 `chat()` 自然重建。

### 3.1 Session 不再强绑定 Workspace

Workspace 从「Session 的身份」降为「Session 的当前目录」。

| | 现在 | 本设计 |
| --- | --- | --- |
| 语义 | 创建时绑定，归属校验强制相等 | 会话当前在哪干活 |
| 落盘 | `session_state.workspace_id` 必填语义 | 同一列，语义改为当前值 |
| 恢复 | `get()` 要求传入 Workspace 且相等，否则抛错 | 不再要求相等，恢复后可在会话中切换 |
| 切换 | 只有 `sessions.workspace()` 这一条显式重绑路径 | `session.set_workspace()`，与 `set({ model })` 同级 |
| 新建 | 没有 Workspace 就退化为内存上下文 | 继承创建者的当前目录；没有就是没有 |

没有 Workspace 的 Session 仍然合法：它只是没有项目文件与 Shell 工具，适用于纯模型对话与生图这类场景。

### 3.2 Workspace 的默认值

`agent.chat()` 不接 Workspace。默认值来自 Agent 构造：

```ts
const agent = new Agent({ id: "coder", model, workspace });

const chat = await agent.chat();          // 继承 Agent 的当前目录
chat.set_workspace(repo_b);               // 会话内切换
await chat.send({ query: "另一个仓库也有这个问题" });
```

- `new Agent({ workspace })` 是**可选**的默认值，不是绑定。Agent 不拥有 Workspace，只在创建 Session 时把它作为初始当前目录。
- Session 自己的当前目录一旦通过 `set_workspace()` 改变，只影响该 Session；Agent 的默认值不变。
- 派出去的 Session 继承创建时那一刻的当前目录，之后各自独立。

理由：用户要的「简化」落在调用点，所以 `chat()` 无参数；而「多 Workspace」是 City 层的事实，所以默认值放在 Agent 上、切换放在 Session 上。让 `chat()` 每次传 Workspace 与让 Session 强绑定，都是把执行参数当身份，两者都被本设计否掉。

> **待确认**：默认值放在 Agent 构造上，是本设计中唯一由我推定、没有经过你确认的取舍。另一条候选是完全不设默认值，由宿主在 `chat.set_workspace()` 上显式给。差别只在宿主多写一行。

## 4. 公开 API

### 4.1 Agent

```ts
export interface Agent {
  /** 与 Agent 自己的那段对话说话；对话不存在时先建立。 */
  chat(input?: AgentChatInput): Promise<AgentChat>;

  /** Session 集合；含 chat 与它派出去的活。语义不变。 */
  readonly sessions: AgentSessionCollection;
}
```

```ts
/** 打开 Agent 自己的那段对话时的可选参数。 */
export interface AgentChatInput {
  /**
   * 建立这段对话时使用的当前目录。
   *
   * 省略时使用 Agent 构造时声明的 Workspace；两者都没有时该对话没有项目文件。
   * 已经存在对话时该参数被忽略，需要换目录请调用 `chat.set_workspace()`。
   */
  workspace?: WorkspaceRuntime;
}
```

### 4.2 AgentChat

```ts
/** Agent 自己那段对话的对话面。 */
export interface AgentChat {
  /** 这段对话的 Session 稳定标识。 */
  readonly session_id: string;

  /** 提交一次用户输入；与 `session.prompt()` 同形。 */
  send(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle>;

  /** 读取历史消息分页；与 `session.messages()` 同形。 */
  messages(input?: ListSessionMessagesInput): Promise<SessionMessagePage>;

  /** 订阅后续变化；与 `session.subscribe()` 同形。 */
  subscribe(subscriber: SessionMutationSubscriber): SessionMutationUnsubscribe;

  /** 停止当前 Turn；与 `session.stop()` 同形。 */
  stop(): Promise<AgentSessionStopResult>;

  /** 列出等待用户响应的 Interaction。 */
  interactions(): Promise<SessionInteractionRequest[]>;

  /** 提交 Interaction 的用户响应。 */
  respond(input: RespondSessionInteractionInput): Promise<SessionInteractionResult>;

  /** 读取当前运行状态；与 `session.status()` 同形。 */
  status(): Promise<AgentSessionStatus>;

  /** 返回这段对话当前的目录；没有项目上下文时为空。 */
  workspace(): WorkspaceRuntime | undefined;

  /** 就地切换这段对话的当前目录；传空表示脱离项目上下文。 */
  set_workspace(workspace?: WorkspaceRuntime): Promise<void>;
}
```

`chat` 是 Session 的窄门面：需要 Session 上的其他能力（`fork`、`system`、`snapshot`）时，用 `await agent.sessions.main()` 取到 Session 本身。

### 4.3 AgentSessionCollection 变化

```ts
export interface AgentSessionCollection {
  /** 返回 Agent 自己的那段对话；不存在时创建。 */
  main(input?: { workspace?: WorkspaceRuntime }): Promise<AgentSession>;

  /** 其余方法语义不变。 */
  create(options?: AgentCreateSessionOptions): Promise<AgentSession>;
  get(session_id: string, origin_type?: string, options?: AgentGetSessionOptions): Promise<AgentSession>;

  /**
   * 删除：把 Session 重新绑定到另一个 Workspace。
   *
   * 删除理由：它表达的是「绑定可以被改写」这个旧模型。目录切换改由
   * `session.set_workspace()` 承担，恢复时不再校验归属，因此不需要第二条路径。
   */
  // workspace(session_id, workspace) —— 移除
}
```

```ts
/** 恢复 Session 时的可选本地上下文。 */
export interface AgentGetSessionOptions {
  /**
   * 恢复后要使用的当前目录。
   *
   * 与持久化值不一致时不再抛错：以该值为准写入当前目录，语义等同
   * `set_workspace()`。省略时沿用持久化值。
   */
  workspace?: WorkspaceRuntime;
}
```

### 4.4 Session

```ts
export interface AgentSession {
  /** 返回当前目录；没有项目上下文时为空。语义不变，来源改为可变状态。 */
  // 现有 `workspace_id` 保持不变，读取改为当前值

  /** 就地切换当前目录。 */
  set_workspace(workspace?: WorkspaceRuntime): Promise<void>;
}
```

`set_workspace()` 与 `set({ model })` 同级：写入 Metadata 的当前值，更新内存快照，从下一个 Step 检查点起生效，执行中的 Turn 不受影响。它不迁移已有消息、附件或工具结果——那些是这段对话的历史，属于它发生时的目录。

## 5. 模型侧能力

Agent 在 chat 的会话上下文里多一组工具，普通 Session 拿不到，因此「会话再派生会话」在结构上不会发生。

| 工具 | 干什么 | 为什么需要 |
| --- | --- | --- |
| `session_start` | 开一条会话并交给它任务 | 场景 2.2 |
| `session_check` | 手上有哪些活、各自什么状态；带 `session_id` 读那一条的细节 | 场景 2.3、2.5、2.6 |
| `session_reply` | 答掉某条会话等着的审批或提问 | 场景 2.4 |
| `session_stop` | 收回某条会话 | 场景 2.10、用户改主意 |

工具在 Agent 构造时闭包住 `AgentSessions`，不去 `ToolCallContext` 回查主体——`ToolCallContext` 明确不携带 Agent 或 Session 句柄，这个边界不破。

每个工具自带 description，因此不注入 instruction 文本，也不做每轮清单注入。模型问进展时自己调一次 `session_check`，比每轮往 system 或 user 消息里塞清单更省，也不会破坏 system 前缀的缓存友好性。

用户实际说人话，不需要知道这些工具存在：「怎么样了」由模型自己决定去调 `session_check`。

### 5.1 按会话身份过滤工具

现在 `get_tools()` 对所有 Session 返回同一集合，`resolve_session_context` 也不感知会话类型。要让 `session_*` 只出现在 chat 里，需要把会话身份带进上下文解析：

```ts
/** AgentSessions 解析单个 Session 执行上下文时的输入。 */
export interface SessionContextResolution {
  /** 本次创建的 Session 的完整来源；`origin.type === "main"` 表示对话面。 */
  readonly origin: SessionOrigin;
  /** 创建或恢复时可选的 Workspace。 */
  readonly workspace?: WorkspaceRuntime;
}
```

`Agent.resolve_session_context` 据此在 `origin.type === "main"` 时把四个工具并入工具集合。这是本次唯一需要改动工具解析链的地方，改动面小且方向单一：工具集合按会话身份解析，而不是全局一份。

## 6. 生命周期与失败语义

| 情形 | 行为 |
| --- | --- |
| 并发调用 `chat()` | 单飞：同一进程内只创建一条主对话，其余调用复用它 |
| 主对话被归档 | 不影响正在执行的 Turn；下一次 `chat()` 新建一条，归档产生的清理沿用现有 `archive()` 语义 |
| 主对话被删除 | 同上，下一次 `chat()` 重建。集合不维护「哪条是主对话」的额外索引 |
| 派出的会话被归档或删除 | chat 的 `session_check` 不再列出它；已发生的 Turn 结果随之消失，这是用户主动操作，不需要额外保护 |
| `session_start` 后立即 `session_stop` | 排队中的输入被取消，状态记 `stopped`；与用户叫停可区分 |
| `session_reply` 目标 Interaction 已失效 | 工具返回明确失败，由模型转述给用户，不静默丢弃 |
| `set_workspace()` 时有 Turn 在跑 | 写入生效于下一个 Step 检查点；当前 Turn 沿用旧值，与 `set({ model })` 一致 |
| 进程崩溃时主对话在跑 | 恢复时按现有 Session 恢复语义处理，不需要额外收口 |

主对话不引入新的后台资源，因此没有需要新增的释放路径；`agent.dispose()` 的现有语义覆盖它。

## 7. 不变量

1. 每个 Agent 至多一条主对话，`origin.type === "main"`，靠分区内单飞创建保证。
2. 主对话是普通 Session，除工具集合与自身身份外没有特殊行为。
3. `session_*` 工具只在主对话的会话上下文中存在。
4. Workspace 不是 Session 的身份。切换目录不改变 Session 标识、历史与附件归属。
5. 没有 Workspace 的 Session 合法，只是不具备项目文件与 Shell 能力。
6. `origin` 仍是唯一的分区与分类事实源；不新增并行索引。

## 8. 存储

不改 schema。

- `session_state.workspace_id` 继续存在，语义由「绑定」改为「当前目录」。
- `origin.type = "main"` 且 `session_id = "main"`，落盘为 `sessions/main/main/`。
- 不做旧数据迁移。既有 Session 的 `workspace_id` 直接当作当前目录读取，行为一致。

## 9. 非目标

- 不做结论自动回流（推送）。当前是拉模式——用户不开口，或者模型不主动 `session_check`，就不会出现主动通知。做推需要比 Turn 活得更久的订阅，归谁持有、重启怎么收口都是新的生命周期问题，留给后续。
- 不改 Desktop 的 `agent_main_sessions` 与 CLI 的「跟随最近会话」启发式。本设计只提供能力，宿主收敛是后续独立改动。
- 不允许会话再派生会话。需要并行时由主对话统一派生。
- 不引入 `thread`、`task`、`subagent` 等新概念别名。只有 Session。

## 10. homepage 文档

需要更新，属于用户可见变化：

- `homepage/content/agent-sdk-docs/{en,zh}/` 新增「Agent 对话」一页：`chat()`、`send` / `messages` / `subscribe`、主对话的身份语义。
- `sessions/session-management.mdx`：`create({ workspace })` 与 `get(..., { workspace })` 的语义改为「当前目录」，补 `set_workspace()`。
- `sessions/metadata-and-storage.mdx`：说明 `main` 分区与 `workspace_id` 的新语义。
- `api-reference/agent-class.mdx`、`api-reference/session-types.mdx`：补新成员与类型。

## 11. 验收

按场景逐条验，不按函数验。

| 场景 | 验收点 |
| --- | --- |
| 2.1 眼前的小事 | 一轮问答不产生第二条 Session；`agent.sessions.list()` 只有主对话 |
| 2.2 事比一轮大 | `chat.send()` 返回时对话空闲；第二次 `send()` 不被前一件事阻塞 |
| 2.3 问进展 | 新起的 `chat.send()` 里模型能列出全部会话及其状态；细节需要一次 `session_check` |
| 2.4 活遇到人 | 用户在 `chat` 上 `respond()`，答复送达目标 Session 并使其继续执行 |
| 2.5 活干完了 | `session_check` 返回终态与摘要，摘要含未决问题 |
| 2.6 活干砸了 | 失败原因与卡点可读；用户补充的信息能回到原 Session 继续 |
| 2.7 换仓库 | 同一条 Session 换目录后继续工作，Session 标识不变 |
| 2.8 换渠道、重启 | 新进程 `agent.chat()` 拿到同一条 Session 与同一份历史 |
| 2.9 人不在场 | 定时任务创建的 Session 与用户派出的活出现在同一份 `list()` |
| 2.10 像活其实是问句 | 一轮内答完，不产生 Session |

补充三条结构性检查：派出的会话上下文里不存在 `session_*` 工具；并发 `chat()` 只产生一条主对话；`set_workspace()` 在 Turn 执行期间不改变该 Turn 的目录。
