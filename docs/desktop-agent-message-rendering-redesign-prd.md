# Desktop Agent Message 渲染重构 PRD

> 状态：已实施（2026-09-08；自动化验证与生产构建通过，GUI 手动验收待产品确认）
>
> 目标范围：`app/desktop/src/renderer/features/chat/`
>
> 后续演进范围：`packages/ui/` 的 Chat Message 公共组件
>
> 文档性质：结构性重构的产品与工程交付合同；不以最少改动为目标，不接受兼容别名或补丁式并存

## 一、结论摘要

经过对 canonical 类型、Desktop Renderer、消息投影、活动渲染、文本引用和 `@downcity/ui` 现状的再次核对，确认以下结论。

### 实施结果

本 PRD 已在 Desktop 内部完成结构迁移：`SessionTimeline` 收敛为页面组合层，`SessionMessageList` 持有分段、渐进挂载和消息级 memo 边界，消息主体统一为 `UserMessage` / `AgentMessage`；Agent Part 使用单层 Projection，并将 Activity、Interaction、Tool Presentation 与 Runtime Indicator 按所有权拆分。旧 `AssistantActivity`、二阶段 Activity 分组和 `step-start` 兼容路径已删除，Desktop Chat Reference 已统一为 `user | agent`。

自动化验证结果：Desktop TypeScript typecheck 通过，Desktop 全量测试 151/151 通过，macOS 原生环境 Electron 生产构建通过。GUI 的键盘、窄窗口、长 Tool 输出和真实流式 Interaction 仍需在发布前完成产品手动验收。

### 1.1 顶层消息只有 User 与 Agent

`packages/type/src/types/session/SessionMessage.ts` 是唯一 canonical 定义：

```ts
export type SessionMessage =
  | SessionUserMessage
  | SessionAgentMessage;
```

对应判别字段为：

```text
SessionUserMessage.type  = "user"
SessionAgentMessage.type = "agent"
```

因此 Desktop Session Chat 的组件语言必须一致：

```text
UserMessage
AgentMessage
```

`AssistantMessage`、`AssistantContent`、`AssistantActivity` 不是当前 Session 领域语言，应从 Desktop Message Renderer 中移除。`assistant` 只允许保留在真正属于模型 Provider 或第三方协议的边界，例如模型消息 role、AI SDK 输出适配器；不能继续作为 canonical Session UI 的主体名称。

### 1.2 需要保留消息级分发，但不保留当前含混命名

此前“直接删除 `MessageRenderer`”的判断不够准确。重新检查性能路径后，确认它不仅做类型分发，还承担了 `React.memo` 的消息级失效边界。若把分发直接并入 `MessageSegment`，单条流式 Agent Message 更新时可能重新协调同 Segment 内其他消息。

正确方案不是简单删除，而是重构为语义明确的：

```text
SessionMessageRow
```

它只负责：

1. 对 `SessionMessage.type` 做穷尽分发；
2. 维护单条消息的 memo 边界；
3. 把 User 与 Agent 各自需要的最小能力传给对应组件。

### 1.3 当前 Agent Message 内部确实存在不必要复杂度

当前实现包含两阶段分组：

```text
group_assistant_content(parts)
→ ActivityBlock
group_assistant_activities(parts, show_reasoning)
→ single | group
```

第二阶段只表达三个结果：零项不显示、一项直接显示、多项聚合显示。它没有独立业务状态，也没有长期稳定的领域含义，应消除，不再创建第二套 `ActivityGroup` 投影类型。

### 1.4 当前代码包含已失效的历史概念

当前 canonical `SessionAgentMessagePart` 已不包含 `step-start`，但 Desktop 的 `assistant_activity.ts` 仍通过类型断言检查 `step-start`。这不是兼容能力，而是类型系统已经无法证明的历史残留，应直接删除。

### 1.5 仓库内已经存在另一套公共 Chat Message

`packages/ui/src/components/chat.tsx` 已包含公共 `ChatMessage`，但它使用另一套宽松协议：

```text
role: user | assistant | system | error
part: text | reasoning | tool | interaction | ... | step-start
```

这与 canonical Session 的 `user | agent` 和封闭 Part 联合不一致。未来不能在 Desktop 重构后再创建第三套公共协议。本次重构应先建立可抽取边界；后续抽取到 `@downcity/ui` 时，应收敛或替换现有公共 Chat Message，而不是并行保留两套事实源。

---

## 二、背景

Desktop Session Chat 当前能够展示：

- User Message；
- Agent 流式文本；
- Reasoning；
- Tool 调用与输入输出；
- Approval / Question Interaction；
- 文件与文件改动；
- Action 与 Error；
- Copy、Quote、Fork 和历史重写；
- 大会话的稳定分段与渐进挂载。

功能基本完整，但结构由多轮迭代叠加而来，出现以下问题：

1. canonical 类型使用 Agent，Renderer 使用 Assistant，领域语言分裂；
2. `SessionTimeline.tsx` 同时承担页面、列表、消息和运行状态展示；
3. `AssistantActivity.tsx` 同时承担内容投影、Tool、Interaction 和表单状态；
4. Part 可见性、操作栏可见性和 Activity 聚合规则分散；
5. 通过 `Extract`、`Exclude` 和强制断言重新制造 canonical 已经具备的类型；
6. Desktop 与 `@downcity/ui` 各自维护不一致的消息展示协议；
7. 现有结构难以在不携带 Electron、Workspace 和 Desktop Store 的情况下被外部复用。

本次工作的核心不是改文件名，而是重新建立清晰的所有权与依赖方向。

---

## 三、产品目标

### 3.1 核心目标

将 Desktop Session Chat 重构为一套以 canonical `SessionMessage` 为事实源、以 `UserMessage` / `AgentMessage` 为主体组件、可独立测试且可后续抽取到 `@downcity/ui` 的消息渲染结构。

### 3.2 用户价值

本次重构原则上不改变用户可见功能，但为后续体验迭代提供稳定基础：

- 流式消息更新不闪烁、不重置展开状态；
- Tool、Reasoning 和 Interaction 顺序始终与真实生成顺序一致；
- 长会话性能不倒退；
- Copy、Quote、Fork 的可用条件一致且可解释；
- Agent Message 的新 Part 或新展示方式可以在明确边界内扩展；
- Desktop 与外部 UI SDK 最终可以使用同一套消息语义。

### 3.3 工程目标

1. 全部 Desktop Session Message UI 使用 `user / agent` 领域语言；
2. 每个模块只有一个稳定变化原因；
3. canonical 数据不在组件树中被复制为第二个状态源；
4. Part 投影是无状态纯函数；
5. React 本地状态只用于展开、输入草稿和提交中等瞬时 UI 状态；
6. 保留当前稳定分段、渐进挂载和消息级 memo 性能边界；
7. 不引入 Renderer Registry、Service、Context 或通用 Manager 等无必要概念；
8. 为后续 `@downcity/ui` 抽取建立无 Electron 依赖的组件边界。

---

## 四、非目标

本次不做以下事项：

1. 不修改 `@downcity/type` 的 canonical Session Message 协议；
2. 不修改 Session 持久化、Mutation、Turn 或 Model 执行逻辑；
3. 不重做 Chat Composer、消息队列或历史重写产品逻辑；
4. 不改变现有视觉样式和交互文案，除非为语义、可访问性或状态正确性所必需；
5. 不在本轮直接发布新的 `@downcity/ui` 公共 API；
6. 不为了“可扩展”把封闭联合类型改成运行时 Renderer 注册系统；
7. 不保留 `AssistantMessage` 到 `AgentMessage` 的兼容导出；
8. 不同时维护新旧两条渲染链路。

---

## 五、现状事实与问题诊断

### 5.1 当前渲染链路

```text
SessionView
└─ project_session_message_segments
   └─ ProgressiveMessageSegments
      └─ MessageSegment
         └─ ChatMessageViewportRow
            └─ MessageRenderer
               ├─ UserMessage
               └─ AssistantMessage
                  └─ AssistantContent
                     ├─ 独立 Part
                     └─ ActivityBlock
                        ├─ ActivityGroup
                        ├─ ReasoningRow
                        ├─ ToolRow
                        └─ InteractionCard
```

### 5.2 当前职责混合

#### `SessionTimeline.tsx`

当前同时拥有：

- MainView Chat 布局；
- 滚动和历史前插位置恢复；
- 空会话状态；
- 消息分段投影；
- 渐进挂载；
- 单条消息分发；
- User Message；
- Agent Message；
- Message Action；
- Agent Runtime Indicator。

该文件的变化原因至少有页面布局、性能策略、User 交互和 Agent 展示四类。

#### `AssistantActivity.tsx`

当前同时拥有：

- Agent Part 顶层渲染；
- Activity 聚合；
- Reasoning；
- Tool 状态与图标；
- Tool 输入输出格式化；
-文件写入与编辑预览；
- Approval；
- Question；
- Generic Interaction；
- Interaction 表单状态。

Tool 协议变化、Interaction 产品变化和 Agent Content 变化都会修改同一模块，内聚不足。

### 5.3 重复或失真的类型语义

当前 `assistant_activity.ts` 重新构造：

- `AssistantTextualPart`；
- `AssistantReasoningPart`；
- `AssistantTextPart`；
- `AssistantActivityPart`；
- `AssistantStandalonePart`；
- `AssistantContentGroup`；
- `AssistantActivityGroup`。

其中部分类型是必要 UI 投影，部分只是为了绕过联合类型收窄。目标结构只保留真正表达 UI Block 的类型，不重新命名 canonical Part。

### 5.4 多处规则判断

当前以下规则没有统一所有者：

- 哪些 Part 对用户可见；
- 未注册 Data Part 是否展示；
- 空 Text 是否展示；
- 哪些 Part 可以连续聚合为 Activity；
- 哪个 Part 决定消息操作栏是否显示；
- Copy / Quote 应收集哪些文本；
- Reasoning 被隐藏后是否仍维持 Tool 聚合边界。

这会让后续增加 Part 时出现“内容显示了，但操作栏规则忘记更新”等漂移。

### 5.5 命名不一致不仅存在于组件名

Desktop 内还存在：

- `should_show_assistant_actions`；
- `AssistantMutationDraft`；
- `data-chat-message-role="assistant"`；
- Chat Reference 的 `role: "assistant"`；
- `.assistant-resource-row`；
- `.assistant-message-menu-bar`；
- `.is-assistant`。

其中与模型协议无关、只描述 Session UI 的命名应统一为 `agent`。真正属于模型 Provider 的 `assistant` 不在本次重命名范围。

---

## 六、设计原则

### 6.1 单一事实源

`SessionMessage[]` 继续是唯一消息事实源。UI Projection 只能是可重建派生值，不得写回或长期复制 canonical 状态。

### 6.2 封闭联合优于动态注册

`SessionMessage` 和 `SessionAgentMessagePart` 都是明确的判别联合。渲染应使用穷尽 `switch`，新增 canonical Part 时由 TypeScript 强制暴露未处理位置。

不引入：

```text
renderer registry
part plugin map
global message context
message service container
```

未知 `data_type` 是唯一开放扩展点，应通过明确的 Data Part 解析器识别；未识别时不展示。

### 6.3 投影负责规则，组件负责交互

- 纯投影负责顺序、分组、过滤、文本汇总和操作栏资格；
- React 组件负责 DOM、交互和瞬时本地状态；
- Desktop 页面负责宿主能力，如打开 Agent、打开 Workspace 文件、Fork 和 Rewrite；
- canonical SDK 负责消息与 Interaction 的真实状态。

### 6.4 组合优于万能组件

目标不是立即创建一个拥有所有 Chat 能力的万能组件，而是形成可组合边界：

```text
SessionTimeline
+ SessionMessageList
+ UserMessage
+ AgentMessage
+ AgentMessageContent
+ AgentActivity
+ AgentInteraction
```

### 6.5 性能边界属于真实职责

稳定分段、渐进挂载、视口隔离和消息级 memo 都解决已存在的大会话性能问题，不属于可以为了目录简洁而删除的偶然复杂度。

---

## 七、奥卡姆剃刀与消融分析

| 候选结构 | 消融结果 | 决策 |
|---|---|---|
| `Assistant` UI 术语 | 删除后功能无损，领域语言更统一 | 删除 |
| 当前 `MessageRenderer` 名称与冗余数组检查 | 删除后无损 | 删除 |
| 消息级 memo 分发边界 | 删除后流式消息可能带动同 Segment 其他消息协调 | 保留，重命名为 `SessionMessageRow` |
| `SessionMessageProjection` 固定 sequence 分段 | 删除后历史前插和流式更新失去稳定引用 | 保留 |
| `ProgressiveMessageSegments` | 删除后大会话切换可能一次挂载全部 Markdown | 保留 |
| `ChatMessageViewportRow` | 删除后离屏静态消息重新参与完整布局与绘制 | 保留 |
| 第一阶段连续 Activity 聚合 | 删除后 Tool/Reasoning 变成零散日志，视觉噪声增加 | 保留 |
| 第二阶段 `single | group` 投影类型 | 删除后只需按可见项数量分支，功能不损失 | 删除 |
| Tool Presentation 纯函数 | 删除后 Tool 名称、状态、图标判断散回组件 | 保留并独立 |
| Interaction 独立组件 | 删除后复杂表单状态回流 Agent Content | 保留并独立 |
| 每种 Part 一个文件 | 文件数增加但没有独立生命周期 | 拒绝 |
| 动态 Part Renderer Registry | 当前 canonical 是封闭联合，无真实插件需求 | 拒绝 |
| 现在直接抽到 `@downcity/ui` | Desktop 边界尚未稳定，且现有公共协议冲突 | 本轮拒绝，稳定后执行 |

---

## 八、目标信息架构与组件结构

### 8.1 目标组件树

```text
SessionView
└─ SessionMessageList
   ├─ EarlierHistoryControl
   ├─ ProgressiveMessageSegments
   │  └─ SessionMessageSegment
   │     └─ ChatMessageViewportRow
   │        └─ SessionMessageRow
   │           ├─ UserMessage
   │           └─ AgentMessage
   │              ├─ AgentMessageIdentity
   │              ├─ AgentMessageHeader
   │              ├─ AgentMessageContent
   │              │  ├─ AgentTextBlock
   │              │  ├─ AgentActivity
   │              │  │  ├─ AgentReasoning
   │              │  │  ├─ AgentTool
   │              │  │  └─ AgentInteraction
   │              │  ├─ AgentFileBlock
   │              │  ├─ TurnFileDiffCard
   │              │  ├─ AgentActionBlock
   │              │  └─ AgentErrorBlock
   │              └─ AgentMessageFooter
   └─ AgentRuntimeIndicator
```

### 8.2 模块职责

#### `SessionTimeline`

只负责：

- Chat MainView 页面布局；
- Header；
-空状态；
-滚动容器与 Composer；
-将当前 Session 数据交给 `SessionMessageList`。

不再定义 User 或 Agent Message。

#### `SessionMessageList`

只负责：

- `project_session_message_segments` 的生命周期；
-历史加载控制；
-渐进挂载；
-Segment memo；
-`ChatMessageViewportRow`；
-顶层 User / Agent 穷尽分发；
-无流式 Agent Message 时的独立 Runtime Indicator。

#### `UserMessage`

只负责 User Message 的：

- canonical parts 展示；
-编辑状态；
-重写策略选择；
-Fork；
-时间与操作栏。

#### `AgentMessage`

只负责 Agent Message 的：

-身份和 Header；
-消息级内容组合；
-消息级 streaming / completed 状态；
-Copy、Quote、Fork；
-Footer 与 Runtime Indicator。

它不得解析 Tool 输入，不得持有 Interaction 表单草稿。

#### `AgentMessageContent`

只负责：

1. 调用 Agent Message 纯投影；
2. 按 Block 类型穷尽渲染；
3. 将 Activity 与 Interaction 所需能力向下传递。

该组件允许 Group Chat 复用内容层，而不被迫渲染 Session Agent Message 的身份行和 Footer。

#### `AgentMessageFrame` / `UserMessageFrame`

消息行的唯一骨架，**两个表面（Agent Session Chat 与 Group 共享消息）共用**：

- `AgentMessageFrame`：身份在上、正文在下的 Agent 侧行。Session 的正式消息、
  Session 的独立「思考中」状态行、Group 的成员发言 / 待响应 / 输入中，四种用法共用它；
- `UserMessageFrame`：右侧气泡 + 下方元信息行的用户侧行。Session 与 Group 共用。

两者的差异只能用 props 表达（身份行动作、`suffix`、`meta`、编辑态、元素语义），
不得在调用处另写一份 DOM：历史上两侧各写一遍，结果 Agent 正文在 Session 侧是
「头像列 28px + 间距 8px」、在 Group 侧是「头像列 32px + px-1」，同一件事两种视觉。

几何（头像尺寸、正文左缘、气泡圆角、元信息行高度）集中在 `message_layout` 的类名常量里，
由 `tests/chat_message_layout.test.ts` 守住「两个表面不得自己写消息几何」。

两个必须保持的不变量：

- **身份行与正文共用同一条左边缘**，因此身份行与正文都不带左内边距；
- **头像与名称是同一个按钮**——它们做同一件事，拆成两个会让键盘用户为同一动作按两次 Tab。

#### `AgentThinkingStatus`

「Agent 正在做什么」的唯一表达：点阵 + 文案 + 可选的文件改动统计。
三种场景（独立状态行、流式消息 Footer、Group 成员输入中）共用它，
live region（`role="status"`）挂在它自身而不是行容器上——变化的是这里的文案，
而且每个场景只有一个实例，既不会重复播报，也不会因为外层容器换了语义就丢掉。

#### `AgentActivity`

只负责连续 Reasoning / Tool / Interaction 的活动展示：

-根据 `show_reasoning` 得到可见活动；
-零项返回空；
-一项直接渲染；
-多项渲染一个可折叠组；
-待响应 Interaction 自动展开；
-流式 Write / Edit 强制展开。

不再创建第二阶段 `single | group` 投影。

#### `AgentTool`

只负责 Tool Row 和 Tool Details。Tool 的 visual kind、状态文案 key、摘要、running / failed 由纯函数提前计算。

#### `AgentInteraction`

只负责 Approval、Question 和 Generic Interaction：

- canonical `part.status` 是真实状态；
-本地只保存未提交回答和 submitting 状态；
-`part_id`、`interaction_id` 或终态变化时必须正确收敛本地状态；
-提交失败后保留用户输入并提供明确恢复路径。

---

## 九、目标数据模型

### 9.1 Agent Message UI Projection

只保留一层真正有展示含义的 Block：

```ts
type AgentMessageBlock =
  | { type: "text"; part: SessionAgentTextPart }
  | { type: "activity"; parts: AgentActivityPart[] }
  | { type: "file"; part: SessionAgentFilePart }
  | { type: "file-diff"; part: SessionAgentDataPart; data: SessionTurnFileDiffData }
  | { type: "action"; part: SessionAgentActionPart }
  | { type: "error"; part: SessionAgentErrorPart };
```

投影结果同时提供消息级派生信息：

```ts
interface AgentMessageProjection {
  /** 按 canonical Part sequence 保持顺序的可见 Block。 */
  blocks: AgentMessageBlock[];
  /** Copy 与 Quote 使用的全部普通文本。 */
  text: string;
  /** 完成态消息是否展示操作栏。 */
  show_actions: boolean;
}
```

以上类型放入 Renderer 的 `types/AgentMessage.ts`，每个字段提供中文文档注释。

### 9.2 单次投影规则

`project_agent_message(message)` 必须在一次遍历中完成：

1. 严格按 canonical `part.sequence` 升序渲染；数组当前排列不是顺序事实源；
2. 已经有序时复用原数组，乱序时复制后排序，不修改 canonical 输入；
3. 跳过空白 Text；
4. 将连续 `reasoning | tool | interaction` 合并为一个 Activity Block；
5. 识别 Turn File Diff Data；
6. 跳过未注册 Data，但未注册 Data 不得切断连续 Activity；
7. 收集普通 Text 供 Copy / Quote；
8. 计算操作栏资格；
9. 不改变任何 Part 对象或数组；
10. 不依赖 React、Desktop Store、翻译或 Electron。

### 9.2.1 失败与文件改动的 canonical 顺序

Renderer 不允许按 Part 类型人工移动 Error 或 File Diff。失败 Turn 的输出写入顺序由 Session 领域层确定：

```text
已产生的 Text / Reasoning / Tool / Interaction
→ Error Part
→ Turn File Diff Data Part
→ Agent Message 进入 failed 终态
```

Error 表达执行在此处失败；File Diff 表达该 Turn 在失败前已经真实发生的文件副作用总结，因此 Error 必须位于 Diff 之前。两者写入同一 Agent Message，并分别获得递增且不可变的 `part.sequence`。无论目标 Agent Message 仍在流式写入还是已经收口，后到的 Error 都作为同一 Message 的 Part 或新 revision 追加；只有当前 Turn 从未产生 Agent Message 时，才创建一条仅含 Error Part 的 Agent Message。

### 9.3 操作栏规则

为了保持现有行为，`show_actions` 定义为：

-消息必须不是 streaming；
-最后一个具有操作边界语义的可见 Part 必须是非空 Text；
-Data Part 不影响该判断；
-空 Text 不影响该判断；
-File、Activity、Action、Error 会阻止“文本结尾”操作栏。

Copy 和 Quote 使用所有普通 Text Part，按 Part 顺序以换行连接，不包含 Reasoning、Tool 输入输出或 Error。

如果后续产品决定“只要消息有文本就展示操作栏”，应作为单独行为变更处理，不在本次结构重构中顺带修改。

### 9.4 Activity 规则

Activity Part 定义为 canonical：

```text
reasoning | tool | interaction
```

显示规则：

1. Reasoning 关闭时只过滤 Reasoning，不破坏其两侧 Tool 的连续关系；
2. 单个可见 Activity 直接显示对应 Row / Card；
3. 多个可见 Activity 显示一个 Group；
4. pending Interaction 使 Group 自动展开；
5. input-streaming 的 Write / Edit 使 Group 强制展开；
6. failed Tool 决定 Group 的失败状态；
7. pending Interaction 的等待状态优先于 running，失败状态优先级最高；
8. Group 摘要取 pending Interaction、最后一个 Tool、最后一个 Reasoning中的首个可用摘要。

### 9.5 穷尽性规则

顶层消息：

```ts
switch (message.type) {
  case "user":
    return <UserMessage />;
  case "agent":
    return <AgentMessage />;
  default:
    return assert_never(message);
}
```

Agent Block 同样必须穷尽。禁止使用 `Array.isArray(message.parts)` 掩盖类型问题；canonical 类型已经保证 `parts` 是数组。

---

## 十、状态与生命周期

### 10.1 状态所有权

| 状态 | 唯一拥有者 |
|---|---|
| Message / Part 内容与状态 | canonical Session Message Store |
| Segment Projection | `SessionMessageList` 可重建缓存 |
| Agent Message Projection | `AgentMessage` 或 `AgentMessageContent` 的 `useMemo` 派生值 |
| Tool 展开状态 | `AgentTool` |
| Activity Group 展开状态 | `AgentActivity` |
| Question 未提交答案 | `AgentInteraction` |
| Interaction submitting | `AgentInteraction` |
| Copy 成功短暂反馈 | `AgentMessage` |
| Fork submitting | User / Agent Message 各自拥有 |
| Scroll / prepend 恢复 | `SessionTimeline` / `use_chat_scroll` |

### 10.2 流式更新

- Agent Message 对象引用变化时，只允许对应 `SessionMessageRow` 重新渲染；
- 同 Segment 内其他消息引用未变化时，不应重新渲染；
- Text Part 使用 Markdown streaming mode；
- 正在 input-streaming 的 Write / Edit 保持预览展开；
- Message 从 streaming 进入终态后，Footer 从 Runtime Indicator 收敛为 Action Bar 或空白；
- 展开状态不应因无关 Part 的流式更新被重置。

### 10.3 Interaction 状态

- pending：可输入或审批；
- submitting：本地按钮禁用并显示进度；
- resolved / cancelled / expired / failed：禁止再次提交并显示终态；
-提交失败：恢复可操作状态，保留答案；
-外部 canonical 更新优先于本地临时状态。

---

## 十一、目标依赖方向

```text
@downcity/type canonical types
          ↓
Agent Message pure projection / Tool presentation
          ↓
AgentMessageContent / AgentActivity / AgentInteraction
          ↓
AgentMessage / UserMessage
          ↓
SessionMessageRow / SessionMessageList
          ↓
SessionTimeline / Desktop MainView
```

禁止反向依赖：

-纯投影不得依赖 React；
-消息组件不得读取 Desktop 全局 Store；
-`AgentMessageContent` 不得理解 Session Sidebar、Workspace Registry 或 Electron IPC；
-`@downcity/type` 不得依赖 Renderer；
-未来 `@downcity/ui` 不得依赖 Desktop。

Desktop 宿主能力通过最小 props 注入：

-打开 Agent；
-响应 Interaction；
-Fork Message；
-Rewrite User Message；
-打开 Workspace 文件；
-渲染 Agent Avatar；
-翻译与 Markdown 展示。

本轮不创建统一 `capabilities` 容器；单个显式 props 更容易理解和测试。只有多个公共组件稳定共享同一能力集合后，才评估是否形成公共接口。

---

## 十二、目标文件结构

```text
app/desktop/src/renderer/features/chat/
├─ components/
│  ├─ SessionTimeline.tsx
│  ├─ SessionMessageList.tsx
│  ├─ ChatMessageViewportRow.tsx
│  └─ messages/
│     ├─ UserMessage.tsx
│     ├─ AgentMessage.tsx
│     ├─ AgentMessageContent.tsx
│     ├─ AgentActivity.tsx
│     ├─ AgentInteraction.tsx
│     ├─ AgentRuntimeIndicator.tsx
│     └─ TurnFileDiffCard.tsx
├─ lib/
│  ├─ message/
│  │  ├─ agent_message_projection.ts
│  │  └─ agent_tool_presentation.ts
│  ├─ session_message_projection.ts
│  └─ ...
└─ types/
   └─ AgentMessage.ts
```

拆分依据是变化原因，而不是组件数量：

- Text、File、Action、Error 等无独立状态的小型 Block 保留在 `AgentMessageContent.tsx`；
- Approval 与 Question 共享 Interaction 生命周期，放在一个模块；
- Tool 的 Row、Details 和 File Change Preview 共享 Tool 生命周期，放在 `AgentActivity.tsx` 或同一 Tool 模块；只有超过合理体积或出现独立复用后再拆；
-不为每个 Part 新建文件。

---

## 十三、命名规范

### 13.1 必须迁移

```text
AssistantMessage                    → AgentMessage
AssistantContent                    → AgentMessageContent
AssistantActivityPart               → AgentActivityPart
AssistantToolPresentation           → AgentToolPresentation
group_assistant_content             → project_agent_message
group_assistant_activities          → 删除
should_show_assistant_actions       → 收入 project_agent_message
assistant_activity.ts               → 删除并由目标纯模块替代
AssistantMutationDraft              → AgentMessageMutationDraft
```

### 13.2 DOM 与样式

Session Chat 自有语义迁移为：

```text
is-assistant                         → is-agent
assistant-resource-row              → agent-message-resource
assistant-message-menu-bar          → agent-message-footer
 data-chat-message-role="assistant" → data-chat-message-role="agent"
```

不应只改 TypeScript 而保留 CSS 与 DOM 中的旧领域语言。

### 13.3 可以保留 `assistant` 的边界

以下属于不同领域，不应机械改名：

-模型 Provider 的 `role: "assistant"`；
-AI SDK / Model Message 协议；
-明确表示“把模型 assistant 输出转换为 canonical Agent Message”的 Adapter；
-外部标准本身规定的 assistant role。

### 13.4 Chat Reference

Desktop 内部文本引用目前使用 `role: "user" | "assistant"`，但它只描述 Session UI 中被引用消息的主体，不是模型协议。应迁移为：

```text
role: "user" | "agent"
```

该修改必须覆盖：

-`ChatTextSelection` 类型；
-`ChatReferenceNodeAttributes`；
-`data-chat-message-role`；
-Selection 解析；
-Reference Event；
-Composer 恢复与相关测试。

不保留 assistant 兼容值，因为它是 Desktop 私有投影，不是持久 canonical 协议。

---

## 十四、可复用组件演进方案

### 14.1 本轮边界

本轮先让 Desktop 内部结构稳定，不直接发布公共组件。原因：

1. Desktop 目前仍带有 Workspace 文件打开、Agent 编辑侧栏和历史重写等宿主能力；
2. `@downcity/ui` 已存在一套与 canonical 不一致的 Chat Message；
3. 直接复制会形成第三套实现；
4. 公共 API 一旦发布，错误边界的成本远高于内部重构。

### 14.2 后续公共目标

稳定后，`@downcity/ui` 应提供可组合的公开组件：

```text
SessionMessageList
UserMessage
AgentMessage
AgentMessageContent
AgentActivity
AgentInteraction
```

公共组件应满足：

-依赖 React 与轻量 canonical 类型；
-不依赖 Electron、Desktop Store 或 DesktopApi；
-宿主通过 props / slots 注入 Avatar、Markdown、链接打开和业务动作；
-提供可用默认视觉与交互；
-支持单独使用，不强迫消费者使用完整 ChatPanel。

### 14.3 与现有 `@downcity/ui` 的收敛

后续不得保留两套并列事实源。需要单独完成以下决策和迁移：

1. 评估让 `@downcity/ui` 直接依赖轻量 `@downcity/type`；
2. 将公共消息主体从 `assistant` 收敛到 canonical `agent`；
3. 移除 canonical 已不存在的 `step-start`；
4. 移除顶层 `system / error` 与 Session Message 的混合；系统信息和错误应使用明确 Part 或 Slot；
5. 用 canonical 封闭联合替代大量可选字段组成的宽松 `DowncityChatMessagePart`；
6. 由适配器处理非 Downcity Chat 数据，而不是污染核心公共协议；
7. 更新 UI SDK 文档、版本和迁移示例。

此阶段属于 `@downcity/ui` 对外 API 变化，必须单独评审并按仓库规范执行版本升级与文档更新。

---

## 十五、响应式与可访问性要求

本次结构重构必须保持并补足以下要求：

1. Message Root 使用语义合理的容器，消息列表维持 `role="log"`；
2.头像与 Agent 名称是**同一个按钮**（它们做同一件事），必须有可读 `aria-label`；
3.所有纯图标按钮必须有 title 与 aria-label；
4.`details / summary` 可通过键盘操作，并有明确 focus-visible；
5. Interaction 使用 `form`、`fieldset`、`legend`、label 和原生 input 语义；
6. submitting / streaming 状态通过 `aria-busy` 或可读状态文本表达；
7.错误使用 `role="alert"` 或等价的可感知语义；
8.长 Tool 输出和公式不得撑破消息容器，应在内容区域内部滚动；
9.触控目标不得因结构调整缩小；
10.窄窗口中 Message Body 保持 `min-width: 0`，长路径、命令和 URL 不造成页面横向滚动；
11.关闭 Reasoning 后，不保留空白 Activity 容器；
12.操作栏不能只依赖 hover，键盘 focus-within 时同样可见。

---

## 十六、迁移计划

### Phase 0：行为刻画

在移动代码前补足纯逻辑测试，锁定：

- Part 顺序；
- Activity 聚合；
-未知 Data 不展示且不切断 Activity；
-空 Text；
-Reasoning 显隐；
-操作栏资格；
-Copy / Quote 文本；
-Tool Presentation；
-pending Interaction 自动展开；
-input-streaming Write / Edit 强制展开。

### Phase 1：统一 canonical 语言

1. 将 Desktop Message UI 的 Assistant 命名改为 Agent；
2. 删除 `step-start` 历史判断和相关断言；
3. 将内部 Chat Reference role 改为 `user | agent`；
4. 清理 CSS、DOM data attribute 和内部类型中的旧命名；
5. 不保留旧文件或 re-export。

### Phase 2：建立单一 Agent Message 投影

1. 新建 `AgentMessage` UI 类型；
2. 实现 `project_agent_message`；
3. 合并内容分组、文本汇总和操作栏判断；
4. 删除 `group_assistant_activities`；
5. 将 Tool Presentation 移入独立纯模块；
6. 删除旧 `assistant_activity.ts`。

### Phase 3：按所有权拆分组件

1. 移出 `UserMessage`；
2. 建立 `AgentMessage`；
3. 建立 `AgentMessageContent`；
4. 建立 `AgentActivity`；
5. 建立 `AgentInteraction`；
6. 移出 `AgentRuntimeIndicator`；
7. 更新 Group Chat 对内容层的复用入口。

### Phase 4：拆分 Timeline 与 Message List

1. `SessionTimeline` 只保留页面组合；
2. `SessionMessageList` 接管分段和顶层分发；
3. 将当前 `MessageRenderer` 替换为 memoized `SessionMessageRow`；
4. 保留固定 sequence Segment、渐进挂载和 Viewport Row；
5. 验证流式更新只失效目标消息。

### Phase 5：清理与验证

1. 删除旧文件、旧类型、旧 CSS class；
2. 搜索 Desktop Session Message 范围内残余 `Assistant`；
3. 完成类型检查、定向测试和完整 Desktop 测试；
4. 对长会话、流式 Tool 和 Interaction 做手动验证；
5. 记录现有 `@downcity/ui` 收敛为后续独立任务，不在本轮复制代码。

---

## 十七、验收标准

### 17.1 架构验收

- [ ] canonical 顶层消息只通过 `user | agent` 穷尽分发；
- [ ] Renderer 组件名为 `UserMessage` 与 `AgentMessage`；
- [ ] Desktop Session Message 路径中不存在 `AssistantMessage` / `AssistantContent`；
- [ ] 不存在 `/lib/assistant/assistant_activity.ts`；
- [ ] 不存在 `group_assistant_activities`；
- [ ] 不存在对 `step-start` 的 Desktop canonical 兼容判断；
- [ ] `SessionTimeline` 不再定义具体 Message 组件；
- [ ] `AgentMessageContent` 不依赖 Desktop Store 或 Electron；
- [ ] Pure Projection 不依赖 React；
- [ ] 不新增动态 Renderer Registry、Context 或 Manager；
- [ ] 不保留新旧双渲染链路或兼容 re-export。

### 17.2 行为验收

- [ ] User Message 的展示、编辑、Fork 与 Rewrite 行为不变；
- [ ] Agent Text 支持静态和流式 Markdown；
- [ ] 数学公式、代码块、表格和 Mermaid 行为不倒退；
- [ ] Text / Activity / Text 的 canonical 顺序严格保持；
- [ ] Reasoning 设置关闭后只隐藏 Reasoning；
- [ ] 连续 Tool 与 Interaction 保持同一 Activity Group；
- [ ] pending Interaction 自动展开；
- [ ]流式 Write / Edit 强制展开；
- [ ] Tool 成功、失败、等待和运行状态正确；
- [ ] File、Turn File Diff、Action、Error 正确显示；
- [ ]未知 Data 安全忽略；
- [ ] Copy、Quote、Fork 行为与可用条件不变；
- [ ] streaming Footer 与完成态 Footer 正确切换；
- [ ] Selection Quote 在 `user | agent` 下正常工作；
- [ ] Group Chat 对 Agent 内容层的复用不倒退。

### 17.3 性能验收

- [ ] 5000 条消息的尾部流式更新不重建历史 Segment；
- [ ] 单条 Agent Message 更新时，同 Segment 其他 Message 的 memo 边界有效；
- [ ]历史前插后已有 Segment 引用保持稳定；
- [ ]切换大会话时仍先挂载最新 Segment，再渐进补齐历史；
- [ ]离屏静态消息继续使用浏览器原生渲染隔离；
- [ ]没有因 Projection 在 render 中重复全量遍历同一 Message parts。

### 17.4 可访问性验收

- [ ]键盘可展开 Activity、Tool 和 Reasoning；
- [ ]键盘 focus 时操作栏可见；
- [ ]Approval 和 Question 有完整表单标签；
- [ ]提交中、运行中、失败和完成状态可被辅助技术感知；
- [ ]窄窗口无页面级横向溢出；
- [ ]错误内容具备 alert 语义。

---

## 十八、测试计划

### 18.1 纯函数测试

新建或重构测试覆盖：

```text
agent_message_projection.test.ts
agent_tool_presentation.test.ts
session_message_projection.test.ts
```

关键用例：

1. `text → tool → text` 输出三个 Block；
2. `reasoning → tool → interaction` 输出一个 Activity Block；
3.未知 Data 位于两个 Tool 之间时仍输出一个 Activity Block；
4. Turn File Diff 输出明确 file-diff Block；
5.空 Text 被忽略；
6. Text 汇总不包含 Reasoning；
7.最后操作边界为 Text 时显示 Action；
8.最后操作边界为 Tool / Error / File 时隐藏 Action；
9. Data 位于末尾时不改变 Action 资格；
10.全部输入对象引用保持不变；
11.全部 Tool kind 和生命周期状态映射正确。

### 18.2 组件测试

覆盖：

- User / Agent 顶层分发；
- Agent streaming / completed Footer；
- Activity 零项、一项、多项；
- Reasoning 显隐；
- Interaction 提交成功、失败与终态；
-展开状态在无关流式更新时保持；
- Copy、Quote、Fork 回调参数；
-可访问名称和键盘交互。

### 18.3 回归验证

必须运行：

```bash
pnpm --filter @downcity/desktop typecheck
node --test app/desktop/tests/agent_message_projection.test.ts
node --test app/desktop/tests/agent_tool_presentation.test.ts
node --test app/desktop/tests/session_message_projection.test.ts
pnpm --filter @downcity/desktop test
```

如果完整 Desktop 测试受工作区其他未完成修改影响，必须分别报告：

-本次定向测试结果；
-完整测试中的既有失败；
-失败是否与本次文件和行为相关。

不得把无关失败描述为本次通过，也不得为了让完整测试变绿而修改无关领域。

---

## 十九、风险与取舍

### 19.1 结构性移动造成大 Diff

这是预期结果。通过行为刻画测试、分阶段迁移和一次性删除旧链路控制风险，而不是通过兼容 re-export 缩小表面 Diff。

### 19.2 memo 边界意外丢失

这是最高性能风险。`SessionMessageRow` 必须保留单消息引用比较，`SessionMessageSegment` 必须继续复用稳定 Segment 引用。

### 19.3 Interaction 本地状态在 canonical 更新后漂移

Interaction 必须以 canonical status 为事实源。本地答案和 submitting 只能是临时状态，并以稳定 interaction identity 为重置边界。

### 19.4 Desktop 与 UI SDK 继续分叉

本轮不直接抽公共 API，但目标依赖必须保持可抽取。后续必须以“替换现有 `@downcity/ui` Chat Message 协议”为方向，不能复制 Desktop 实现形成第三套协议。

### 19.5 过度拆分

拆分只围绕页面、列表、主体消息、Activity、Interaction 和纯投影。无状态的小型 Part 不单独建文件，避免把代码阅读变成跨文件追踪。

---

## 二十、完成定义

本次重构完成的判断不是“新文件已经创建”，而是同时满足：

1. canonical 语言统一；
2.职责所有权清晰；
3.旧链路完全删除；
4.行为与性能不倒退；
5.类型穷尽且无历史断言；
6.定向与完整验证结果透明；
7.组件不依赖不必要的 Desktop 上层状态；
8.后续可从 `AgentMessage` / `AgentMessageContent` 边界抽取到 `@downcity/ui`，无需搬运 SessionTimeline、Electron IPC 或 Workspace Store。

只有以上条件全部满足，才能认为 Agent Message Renderer 已从历史叠加结构收敛为可长期演进的设计。

---

## 二十一、后续收敛：Tool 展示的单一映射（2026-09-14）

> 状态：已实施
>
> 范围：`app/desktop/src/renderer/features/chat/` 的 Tool 展示层与 `styles/chat.css` 活动区

### 21.1 触发原因

第十二至二十节完成后，Tool 展示仍有三类遗留成本：

1. Tool 名称启发式、状态文案、摘要与详情渲染分散在纯映射模块和组件之间，新增一种 Tool 要同时改投影、组件分支与 i18n。
2. 组件用 `streamed_field` / `streamed_fields` / `decode_json_fragment` / `build_streamed_edit_pairs` 四个函数手工解析流式 JSON 原文，同一件事有四套实现。
3. Tool、Reasoning 与活动组各自手写一份 `details / summary` 结构，语气样式判断重复三次。

同时确认 `.activity-tool-terminal`、`.activity-tool-change-preview`、`.activity-tool-payload`、`.activity-tool-write-content`、`.activity-tool-diff-marker`、`.activity-tool-item`、`.reasoning-activity-row`、`.activity-tool-detail.is-write` 等类名已无引用，或被后续规则完全覆盖。

### 21.2 决策

- **规则表是唯一映射。** `AGENT_TOOL_RULES: Record<AgentToolVisualKind, AgentToolRule>` 定义每个种类的摘要与详情；新增种类由 `Record` 强制补全，组件不再按 Tool 名称分支。
- **输入读取只有一条规则。** `read_input()` 结构化参数优先，`input-streaming` 时回退到原文；摘要与详情共用它。
- **流式原文读取只保留一个函数。** `read_streaming_input_values()` 按 JSON 字符串词法扫描：只有紧跟在字段名之后的值才会命中，字段名出现在内容里不误配，未闭合的值按当前进度返回。原四个解析函数全部删除。
- **详情形态收敛为三种。** `AgentToolDetail = code | console | edit`；组件只按形态渲染，不再理解 Tool 语义。
- **活动行只有一个结构。** `ActivityRow` 统一 Tool、Reasoning 与活动组的图标、状态、摘要、徽标与展开容器；语气由 `AgentToolTone = running | complete | failed` 表达，样式钩子映射只写一次。
- **失败原因独立于详情。** `error` 与 `detail` 分离，所有种类都在详情区渲染可读原因。

### 21.3 行为与视觉

- 视觉不变：被删除的 CSS 选择器均已无引用，或已被更具体的 `.activity-tool-edit-diff` 规则完全覆盖；`waiting-user` 仍为静态样式，因为被交互阻塞不是推进。
- 两处正向变化：流式期间摘要会显示正在到达的字段（例如文件路径）；失败 Tool 的 `error` 对全部种类可见，此前只有 shell 把错误拼进控制台文本。
- 未知结构化输出的兜底文本由「原始值用 `·` 连接」改为逐行 `key: value`，不隐藏嵌套结果。

### 21.4 验证

```bash
pnpm --filter @downcity/desktop typecheck   # 通过
pnpm --filter @downcity/desktop test        # 285/285 通过
```

`agent_tool_presentation.test.ts` 增加覆盖：语气映射、三种详情形态、失败原因与详情独立、流式字段读取不误配、流式 Edit 配对、未知输出兜底。

### 21.5 仍未处理

运行态仍是第二事实源：turn 与 Tool 状态由主进程 `AgentController` 反推为 `runtime` 后经独立通道广播，Renderer 侧因此保留一套 `chat_runtime_projection`。`warning:model_request` mutation 至今没有消费方，模型请求失败与自动重试对用户不可见。两项都属于后续独立变更。

---

## 二十二、后续收敛：Action Part 纳入活动集合（2026-09-14）

> 状态：已实施
>
> 范围：`app/desktop/src/renderer/features/chat/` 的消息投影、活动展示与 `styles/chat.css` 活动区

### 22.1 触发原因

canonical `SessionAgentActionPart`（fork、上下文压缩、命令等）此前自成一条渲染路径：投影层给它单独的 `{ type: "action" }` Block，组件用一段内联 Tailwind 类名渲染。结果是同一段连续活动里出现两种行样式：

| 维度 | 活动行（`.activity-tool-row`） | Action 行（内联类名） |
| --- | --- | --- |
| 字号 | 13px | 11px |
| 图标 | 按种类映射 | 无 |
| 左侧装饰 | 无 | 1px `border-divider` 竖线 |
| 缩进 | 由行结构决定 | `pl-2` + `items-baseline` |
| 展开 | `details / summary` | 无 |

同时，因为 Action 独占一个 Block，`Tool → Action → Tool` 会被切成「活动组 / Action / 活动组」三段，时间连续性被打断。

### 22.2 决策

- **Action 是活动 Part，不是独立 Block。** `AgentActivityPart` 补入 `SessionAgentActionPart`，`AgentMessageBlock` 去掉 `action` 成员；投影层把 Action 交给 `append_activity_part()`。
- **Action 不改变操作栏资格。** 与改动前一致：它不作为 `last_action_boundary`，因此位于消息末尾的 Action 不会剥夺正文的 Copy / Quote 资格。
- **展示映射模块拥有三种活动的唯一映射。** `agent_tool_presentation.ts` 更名为 `agent_activity_presentation.ts`，新增 `resolve_agent_action_presentation()`；它与 `resolve_agent_tool_presentation()` 产出同一个 `AgentActivityPresentation`，因此组件只按结构渲染，不按 `action_type` 分支。
- **展示层类型收敛为活动层共用。** `AgentToolTone` / `AgentToolDetail` / `AgentToolEditPair` / `AgentToolPresentation` 更名为 `AgentActivityTone` / `AgentActivityDetail` / `AgentActivityEditPair` / `AgentActivityPresentation`。
- **图标表只有一个。** `AGENT_ACTIVITY_ICONS: Record<AgentActivityVisualKind, …>` 覆盖 Reasoning、Tool 与 Action 的全部种类，新增种类由 `Record` 强制补全。
- **组摘要实现对齐既有文案。** 原 `find_last_tool()` 只找最后一个 Tool，而注释写的是「最后一个非 Reasoning 项」；Action 加入后两者分叉，改为 `find_summary_part()`，Tool 与 Action 一视同仁。

### 22.3 用户可见变化

- Action 行与 Tool / Reasoning 行完全同构：图标 + 本地化状态词 + 标题 + 展开箭头，`running` 时参与脉动动画。
- Action 的 `description` 与 `data` 移入展开区；折叠态只保留标题。失败 Action 的 `description` 按错误原因呈现（沿用 Tool 的 `error` 语义），不再当作普通描述。
- `Tool → Action → Tool` 现在合并为一个可展开组，`Tool → Action` 的组合组摘要由 Tool 变为 Action（最后一个非 Reasoning 项）。
- 新增 i18n：`activity.action.running|completed|failed`。

### 22.4 验证

```bash
pnpm --filter @downcity/desktop typecheck   # 通过
pnpm --filter @downcity/desktop test        # 306/306 通过
```

`agent_activity_presentation.test.ts`（原 `agent_tool_presentation.test.ts`）增加覆盖：Action 类别映射、三态文案与语气、描述与 `data` 进入详情、空描述不可展开、失败描述归入 `error`、空标题回退、Action 不触发自动展开。`agent_message_projection.test.ts` 增加覆盖：Action 并入相邻活动不产生独立 Block、Action 不改变操作栏资格。

### 22.5 仍未处理

`@downcity/ui` 的公共 Chat 渲染器仍把 Action 映射为独立的 `operation` Part（`packages/ui/src/lib/session-message.ts`），与 Desktop 的 activity 集合不同源。按 §1.5 的约定，公共组件抽取时应收敛到同一套活动语义，而不是并行保留两套。

---

## 二十三、Markdown 图表渲染改由 Desktop 自持（2026-09-14）

> 状态：已实施
>
> 范围：`app/desktop/src/renderer/components/markdown/`、`styles/mermaid.css`、`locales/*/markdown.json`

### 23.1 触发原因

Mermaid 此前走 Streamdown 内置分支，只传了 `controls.mermaid: true`，未传 `mermaid.config`。图表因此使用默认 `theme: "default"` 与 monospace 字体，不认 Desktop 的九套主题：深色模式下呈现浅色节点与紫色连线，与正文完全脱节。该分支同时把渲染 id、并发策略、Loading 文案与缩放控件封在内部，无法按 Desktop 的令牌体系调整。

### 23.2 决策

- **围栏在 rehype 阶段改写为图表节点。** `rehype_mermaid_blocks` 把 `pre > code.language-mermaid` 换成 `mermaid-diagram`，由 `markdown_components` 映射到自有组件。位置在 sanitize 之后，因此改写出的自定义元素不会被默认 schema 当作未知标签丢弃。代码块、表格与公式仍走 Streamdown 原管线。
- **主题令牌映射只有一处。** `read_mermaid_theme_tokens` 从 `documentElement` 读取语义令牌，`build_mermaid_config` 生成 `themeVariables` 与 `themeCSS`；`c0..c4` 色阶由主色向背景与前景两端派生——Mermaid 用 khroma 计算配色，只能接受具体颜色值，不能把 `var()` 或 `color-mix()` 交给它。
- **渲染串行且有确定性 id。** `mermaid.initialize` 与 `mermaid.render` 共用模块级状态，长会话中多图并发会互相覆盖；所有渲染进入同一条队列，id 由「渲染位置 + 源码」的稳定散列生成。
- **主题在渲染时读取。** 配置不缓存，每次真正渲染时重新读取令牌；主题写在 `<html>` 上而非 React 状态，因此由 `use_document_theme_revision` 把文档级变化转成可依赖的计数。
- **状态机为占位 / 画布 / 源码。** 懒渲染（进入视口前 320px 才渲染）；**重新渲染期间保留上一张图**，避免流式生成时每个 chunk 都把图表打回占位；失败只在流式结束后算数，之前一律显示渲染中。

### 23.3 与 Duobox 的偏离

- 全屏改用 react-zoom-pan-pinch v4 内建的 `fitOnInit="contain"` 与 `fitToView()`，不再手算适配缩放。
- 内联视图不套缩放组件，交给 Mermaid 自身的 `width` / `max-width`，省掉一层恒为 `scale: 1` 的 transform。

### 23.4 验证

```bash
pnpm --filter @downcity/desktop typecheck   # 通过
pnpm --filter @downcity/desktop test        # 309/309 通过
```

`markdown_mermaid.test.ts` 覆盖围栏改写（大小写、多类名、嵌套、行内代码、无 code 的 pre）、色阶单调性、主题令牌进入配置、导出尺寸收敛，以及一条走真实 Streamdown 管线的端到端断言（同时证明 sanitize 没有吞掉 `language-mermaid`）。

### 23.5 未验证

图表观感（`themeCSS` 密度、全屏手感、深色模式配色）未经人工确认；渲染层打包在本环境受容器内存上限限制、无法完成 emit，产物需在本地执行 `pnpm build:desktop` 生成。

---

## 二十三·补、代码块呈现简化（2026-09-16）

> 状态：已实施（自动化守卫通过；GUI 目检待产品确认）
>
> 范围：`app/desktop/src/renderer/styles/markdown.css`、`app/desktop/tests/markdown_code_block.test.ts`

代码块不是自有组件，而是 Streamdown 渲染的 DOM（`[data-streamdown]`）加上一层覆写样式。原实现把这层覆写做成了「重排库的 DOM」：把元信息行绝对定位到右上角、藏掉语言标签、只留一个 hover 淡入的复制按钮。结果是两个可复现的错误：容器底色在浅色主题下只有 `rgb(251,251,251)`（背景 255），而 ocean / forest 这类主题的 `muted` 是饱和色，同一混色把整块染成蓝底或绿底；复制按钮 26px、代码区上内边距 11px，纵向必然压住首行，且代码区横向滚动时浮层会被长行穿过。

决策：

- **一档中性填充，不要边框。** 底色统一为 `--surface-subtle`（浅色 4% / 深色 8% 前景色），圆角用 `--radius`。九套主题 × 明暗由同一推导得出，不再逐主题校对显式混色。
- **元信息行回到普通流布局。** 语言在左、复制在右，`min-height: 1.5rem`，不覆盖代码区。它是「操作不压住代码」的代价，同时回答「这段是什么语言」。
- **复制按钮 24px 常显。** 24px 是 WCAG 2.2 目标尺寸下限，也是次级图标按钮的触控高度；尺寸用 rem 而非本文件的 em 方言，因为同一代码块也渲染在 Plugin 说明（`xs`）等更小宿主里。hover 改用 `--interaction-hover`，焦点环与消息操作栏统一为 `ring-2 / ring-ring-30`。
- **行内码改用 `--surface-emphasis`。** 与块级代码共用一套「代码底色」语义，靠面积而非各自的混色区分。
- **删掉不生效的规则。** `.shiki span` 在本版本 DOM 中不存在；`counter-increment: none` 无法关掉库放在 `::before` 上的计数器；行号本身依赖 `before:content-[counter(line)]` 这类任意值工具类，本仓库不扫描 `node_modules`，根本不会生成。

已知保留项（都不在样式表可及范围内，故不修）：库的懒加载骨架屏不受 `[data-streamdown]` 选择器管辖，形态与加载后不一致；复制按钮 `title` 是库写死的英文 `Copy Code`；库只提供 `controls.code` 一个总开关，下载按钮只能隐藏。

验证：`markdown_code_block.test.ts` 8 项断言上述决定（底色令牌、无边框、元信息行非浮层、语言标签可见、复制按钮尺寸与焦点环、下载按钮隐藏有注释依据、深色翻转只剩一条）。Desktop 全量测试 432/433 通过；唯一失败项 `chat_plugin_sidebar_renderer.test.ts` 期望 Channel 含 `qq`，与本次改动无关。

---

## 二十四、消息阅读字号与块间距归位（2026-09-16）

> 状态：已实施
>
> 范围：`features/chat/components/messages/message_layout.ts`、`AgentMessageContent.tsx`、`UserMessageContent.tsx`、`features/group/GroupView.tsx`、`styles/base.css`、`styles/markdown.css`、`styles/tokens.css`

### 24.1 触发原因

用户反馈 Agent 消息「字体有点小」，并指出活动与正文之间太挤。核对后发现是两个独立缺陷叠加：

1. **同一个字号有两个来源。** `agent_message_body_class_name`（容器）声明 `text-sm`（14px），`AgentMessageContent` 的正文块又把它覆盖为 `text-[0.8125rem] leading-[1.54]`（13px）；`GroupView` 的 Agent 发言同样内联 13px。13px 是 `2f73f6a` 把固定 px 字号换成 rem 等价写法时保留的旧值。
2. **块间距为 0。** `agent_message_body_class_name` 是 `gap-0`，而 `.markdown > :first-child/:last-child` 已把段落外边距清零（这是为了让正文容器不被首尾留白撑开），因此正文与紧随其后的工具活动行之间**没有任何间隔**，只有活动行自身的 `padding` 0.08rem。两者看起来像同一段文字的上下两行。

### 24.2 字号取值的两次修正

字号不是一次定下来的，这里保留完整过程，因为它是本节的唯一依据来源：

| 轮次 | 取值 | 反馈 | 结论 |
| --- | --- | --- | --- |
| 初始 | 14px（`text-sm`） | 「可以。大一点。」 | 14px 可用，但不是目标；且容器/正文两处声明必须合一 |
| 第二次 | 16px（`text-base`） | 「太大了。小一点。」 | 16px 超出上限 |
| 第三次 | 15px | 「行间距有点小」「text 和 activity 之间的间距有点大」 | 字号附近；转而行高与块间距 |
| 第四次 | 15px / 1.7 / 10px | 「行内间距大一点」「字体稍微再大一点点」 | 行高与字号都还差一点 |
| 第五次 | 15.5px / 1.8 / 10px | 「我是说 agent message，现在 user message 太大了」 | 以为只是归组问题（实际是缺陷） |
| 第六次 | Agent 15.5 / 用户 14px | 「现在 user message 字体太大了。小点啊」 | 仍无效 |
| 第七次 | Agent 15.5 / 用户 13px | 「agent message 和 user message 的字体应该保持一致」「还是很大」无变化 | 此时才发现字号根本没生效 |
| 第八次 | 两侧共用 15px | 「用户消息的字体还是很大！！！你检查一下」 | 真的生效了，但 15px 仍然偏大；同时发现机制层面还有第二个隐患 |
| 最终 | 两侧共用 **14px / 1.8**；块间距 10px | — | 机制改为不依赖工具类；取值取区间中点 |

### 24.2b 两个静默失效（都已修复）

从第五轮开始的「改了没反应 / 还是很大」，**不是审美分歧，而是缺陷**。

**失效一：`cn()` 删掉了字号类。** `cn` 底层是 tailwind-merge。它不认识自定义字号
`text-message`，会把它归到**文字颜色**组（颜色组接受任意自由值），于是：

```text
twMerge("text-message text-foreground") → "text-foreground"
```

字号类被当成「与 `text-foreground` 冲突的颜色」直接删除。从把消息字号改成令牌那一刻（`371f2e461`）起，**所有基于令牌的字号都没生效过**，一直退回 `inherit`（根字号 16px）。

**失效二：工具类还依赖扫描器产物。** 就算修好 twMerge，`text-message` 能否生效还取决于
Tailwind 源码扫描是否命中并生成 `.text-message`。这是第二条可能静默失效的链路，
而且本环境（无 oxide 原生模块）无法验证真实构建产物。

两个失效对现有四道防线全部隐形：

| 防线 | 为何没拦住 |
| --- | --- |
| TypeScript | 类名就是字符串 |
| Tailwind 产物 | `.text-message` 规则确实生成了 |
| `chat_message_layout.test.ts` | 断言的是源码里的类名常量，字符确实存在 |
| 设计令牌漂移守卫 | 只禁固定 px 字号，不管类名是否被删 |

### 24.2c 修复：不再让字号依赖工具类

不是给 twMerge 打补丁，而是**把字号从工具类链路里拿出来**。

字号改由 `styles/chat.css` 的普通类 `.chat-message-text` 提供：

```css
.chat-message-text {
  font-size: var(--text-message);
  line-height: var(--text-message--line-height);
}
```

这个类名不是 Tailwind 工具类形状，因此：

- twMerge 不会对它做任何归类（未知类名一律保留），失效一消失；
- 规则写在样式表里，不需要扫描器生成，失效二消失；
- 本条规则是**无图层 CSS**（chat.css 内无 `@layer`），优先级高于 Tailwind 的
  `@layer utilities`，所以就算将来有人在元素上误加其它字号工具类，也盖不掉它的值。

同时保留一条测试点：`chat_message_layout.test.ts` 断言排版类**必须**是 `chat-message-text`
且不得出现自定义 `text-*` 形状的类；`tailwind_merge_classes.test.ts` 则跑
**真正的 `cn`** 验证四个真实调用点都保留了它（并含一条反向断言，证明守卫不是恒真）。
这两个文件合起来才能拦住同一个错误：一个测源码意图，一个测运行时转换结果。

### 24.2d 教训

1. **类名只存在字符串里时，静态断言不等于它进了 DOM。** `cn` / tailwind-merge 位于
   源码与浏览器之间，是一个会重写类名列表的转换点；对它的验证必须调用它本身。
2. **不要让样式属性依赖工具类生成。** 工具类要过「扫描器命中 → 生成规则 → twMerge 保留」三道关，
   每一道都可能静默失败。值为一的样式（如消息阅读排版）直接写在样式表里最可靠。
3. **排查顺序应当是「值到底有没有到达浏览器」，而不是先在概念层（归组、角色）找原因。**
   前几轮在归组上反复修正，方向从一开始就错了。

### 24.3 决策

- **消息阅读排版就是一个值：`--text-message`（14px）+ `--text-message--line-height`（1.8），
  由 `styles/chat.css` 的 `.chat-message-text` 消费。** 两侧一致是明确的产品要求。
- **取值 14px 是两条反馈夹出的区间中点。** 两侧必须相等 ⇒ 只能一个值；而 13px 被
  「Agent 正文有点小」否、15px 被「user 还是很很大」否 ⇒ 14px。它也是应用已有的 `text-sm` 档。
- **四个消费处：** Agent 正文、用户消息、Group 的两种发言、Composer
  （`.chat-input-editor`）。Composer 必须同值是因为它与用户气泡是同一段文字在发送前后的两种状态。
- **排版类走普通 CSS 类而非 Tailwind 工具类**（理由见 24.2c）。`--text-message` 仍在
  `@theme` 里定义，因此它仍是可被 Tailwind 识别的令牌，只是我们不让它承担消息字号这一个用途。
- **消息内的块间距保持 `gap-2.5`（10px）。** 本次未要求，且三个量级的关系仍成立：
  段落 0.5em = 7.5px < 块间距 10px < 消息间距（根容器 `py-2` 合计 16px），
  差值 2.5px 仍在 2px 的可感知下限之上。
- **Markdown 段落间距 `0.35em → 0.5em`。** 旧值是按 13px 定的；新字号下段落间距必须继续保持
  小于块间距，0.5em 是同时满足「读得开」与「小于块间距」的取值。列表块外边距一并对齐到 0.5em。
  注意它是按 **消息字号**缩放的：两侧共用同一字号，因此段落间距在两边一致。
- **空块最小高度改用 `min-h-[1lh]`。** 原来写死 `1.54em`（一行），字号与行高一变就要跟着改；
  `1lh` 等于当前行高，随令牌自动走，界面缩放也一样。
- **气泡内边距 `px-3 py-2`。** 两侧统一字号后保留原值，未跟字号联动；若目测偏紧再调一档即可。
- **不改 Workspace 文档预览、README 与 Plugin 说明。** 中途曾把它们从 14px 提到 16px，
  理由是避免「会话正文比它所讨论的文档还大」；现在消息正文与文档都是 14px，
  两者一致，保留原值可以避免把一个未受理的反馈扩散到更多表面。
- **活动行、交互卡片、失败提示条的字号与间距不变。** 那些是消息里的操作与元信息（13px / 12.5px），
  不是阅读正文；活动行**内部**的间距（`.agent-process-body` 0.22rem）也不动，
  否则同一对「Tool 行 + Interaction 卡片」的间距会随分组状态变化。

### 24.4 用户可见变化

| 位置 | 改动前（一系列改动前） | 现在 |
| --- | --- | --- |
| Agent 正文、Group Agent 发言 | 13px / 20px 行高 | **14px / 25.2px 行高** |
| 用户气泡、Group 用户发言 | 13px / 17.4px | **14px / 25.2px 行高**（与 Agent 一致） |
| Composer、就地编辑 | 13px / 17.4px | **14px / 25.2px 行高** |
| 正文与活动之间的间距 | 0px（仅活动行内边距） | **10px** |
| Markdown 段落之间 | 4.6px | **7px** |
| Workspace 文档预览、README | 14px / 23.8px | 字号不变，行高不同 |
| 工具活动行、Reasoning、chips | 13px / 12px / 11px | 不变 |

**用户可见变化三项**：消息正文（两侧）13px → 14px；行高 1.34/1.54 → 1.8；
正文与工具活动间多出 10px 间距。注意**字号是到第八轮才真正生效的**——
前面的 commit 虽然改了值，但因上述两个缺陷从未影响渲染。

Markdown 内部按 em 派生的取值随之变化（两侧同基准 14px）：
`h1/h2/h3` 从 20.2 / 17.4 / 15.6px 变为 21.7 / 18.2 / 16.1px（标题行高固定 1.3，不跟正文行高走），
行内码、代码块、表格同为 14px 的 0.9–0.92 倍。

### 24.5 未处理

- **内联 chip 仍是 11px**（`.user-message-atom`、`agent-message-resource`、Composer 的 mention/ref/data 节点）。它们相对 14px 正文仍偏小，但在 Composer 与气泡两侧同值、未产生漂移，因此未一并调整。
- **Plugin 自带 Markdown 仍是 12–13px**（`PluginView` 的 README、`PluginRendererComponents` 的 `Markdown`）。它们是 Plugin 自己的 UI，宿主不应单方面改变其密度。
- **消息列仍为 `max-w-[840px]`。** 14px 下每行约 60 个汉字；继续缩窄会连带影响 Composer、表格与代码块宽度。
- **活动行内部的间距未动**（`.agent-process-body` 0.22rem、`.activity-tool-group-body` 0.25rem）。单条 Tool 与成组 Tool 落在不同的容器上，只调其中一个会让同一对「Tool 行 + Interaction 卡片」的间距随分组状态变化。
- **消息字号上限仍受块间距约束。** 段落间距是 0.5em（随消息字号走），而它必须比消息内的块间距
  （`gap-2.5` = 10px）至少小 2px：`0.5 × 字号 ≤ 8px`，即**字号不得超过 16px**。当前 14px 下差值为 3px。
- **不要再把字号改成 Tailwind 工具类。** 自定义 `text-*` 工具类会过三道可能静默失败的关
  （扫描器命中 → 生成规则 → twMerge 保留）。需要新的排版类时，直接写在 `styles/chat.css`。

### 24.6 验证

```bash
cd app/desktop && node --test tests/*.test.ts   # 410/411；唯一失败为既有的 qq 渠道断言
cd app/desktop && ./node_modules/.bin/tsc -p tsconfig.web.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.node.json --noEmit   # 通过
```

- **`tailwind_merge_classes.test.ts`**：跑**真正的 `cn`**（而不是比对源码文本），验证四个真实
  调用点都保留 `chat-message-text`；断言排版类不得是 Tailwind `text-*` 形状；
  并含一条**反向**断言（当初那神写法 `text-message` 确实会被吞）证明守卫不是恒真。
- `chat_message_layout.test.ts` 三条守卫：块间距以像素夹在段落间距与消息间距之间且留有 ≥ 2px
  可感知差（该项已两次变异验证：字号改 17px 失败、块间距改 `gap-2` 失败）；
  消息字号只有一个来源且四处都用它；Composer 与消息正文引用同一对令牌。
- 链路已逐步实测：令牌 `0.875rem × 1.8` → `.chat-message-text` 规则只引用 `var()` →
  四处的 `cn()` 产物均保留该类 → `--text-message` 确认注入 `:root`；
  chat.css 内无任何 `@layer`，因此该规则为无图层 CSS，优先级高于 Tailwind 工具类。
- **本环境不能验证的事**：Tailwind 扫描器在真实构建中是否生成 `.text-message`
  （本机无 oxide 原生模块，repo 在 macOS 构建、沙箱为 Linux）。
  正因为无法验证，这一稿才不依赖它——这是决定改成普通 CSS 类的原因之一。

GUI 观感未经人工目测确认。本节的取值（字号 14px / 行高 1.8 / 块间距 10px）是按逐条反馈
收敛出的区间解；改字号只需动 `tokens.css` 的一个数，Agent 正文、用户消息、Composer 三处一起走，
但**动它前先重算与块间距的 2px 约束**。






