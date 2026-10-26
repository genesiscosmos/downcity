# Agent 与 Session 边界权威核定

> 核对日期：2026-10-23。本文冻结参数面、来源与身份规则、能力边界三个方面的当前实现。
>
> 最终承载文档：`public/docs/session-agent-boundary-audit.md`。没有采用建议路径 `session-agent-boundary.md`，因为该文件已经存在，且包含相互冲突、过时的结论，例如“任何会话都可派发、上限 3”与“三个角色常量”。本文独立承载本次重新核实的边界定义，相关事实以本文为准；旧文件保留原貌，后续合并/退役须由用户决定。
>
> `session-runtime-architecture.md` 继续负责组件所有权与执行不变量；`agent-chat-design.md` 作为历史设计输入，其主张不能整体视为已实现。本文分别列出采纳、部分采纳、放弃的判断。
>
> 本次只产出本文；未修改业务代码、旧文档、测试或版本号，未提交 git。

## 一、当前实现

### 1. 核定口径与总体边界

Agent 持有身份、默认模型、静态 instruction、自有工具与唯一 Session 集合。Session 持有连续执行、可变配置与自身历史；City 提供存储和 Power 容器，Workspace 提供执行资源。未加入容器的 Agent 默认采用进程内存储，不能将 SDK 构造成功等同于用户目录已经落盘。[Agent.ts:121](../packages/agent/src/agent/Agent.ts#L121)、[Agent.ts:137](../packages/agent/src/agent/Agent.ts#L137)、[AgentSessions.ts:111](../packages/agent/src/agent/AgentSessions.ts#L111)

当前来源分两层：`category` 是封闭的 `chat | work`，决定分区与身份作用域；`type` 是开放字符串，表达角色并参与细粒度能力判定。已知角色有六个，全部导出常量。未知角色必须显式给 category，已知角色不能声明与映射相反的 category。[SessionOrigin.ts:20](../packages/type/src/types/session/SessionOrigin.ts#L20)、[:63](../packages/type/src/types/session/SessionOrigin.ts#L63)、[:112](../packages/type/src/types/session/SessionOrigin.ts#L112)、[:129](../packages/type/src/types/session/SessionOrigin.ts#L129)

本文采用三个证据等级：

- **确认事实**：已读类型、执行分支和实际创建/使用位置，可由静态链路直接得出。
- **静态疑点**：实现与注释或预期冲突，未运行场景验证，不表述成已验证的线上故障。
- **范围限制**：覆盖当前仓库生产 TS/TSX 创建入口与 origin 引用；不声称列尽第三方插件、运行时输入、用户历史数据库内的所有字符串值。

### 2. 参数面清单

归属层表示规则或资源的拥有者：SDK core 维护核心机制；宿主持有运行时资源和恢复；调用方声明业务输入。“公开”是当前公开形状，“扩展端口”面向实现者，“装配协议”由内部组合根填充；这些标记不是兼容承诺。`—` 表示必填，`undefined` 表示未提供该能力。

#### 2.1 AgentOptions：全部 14 个字段

字段定义见 [AgentOptions.ts:33](../packages/agent/src/types/agent/AgentOptions.ts#L33)，实际默认值见 [Agent.ts:137](../packages/agent/src/agent/Agent.ts#L137)，Session 默认类和 Composer 见 [AgentSessions.ts:132](../packages/agent/src/agent/AgentSessions.ts#L132)。下表“定义行”均指 AgentOptions.ts。

| 字段 | 类型 | 默认值 | 归属层 | 是否稳定 | 备注 / 定义行 |
| --- | --- | --- | --- | --- | --- |
| `id` | `string` | — | 调用方；core 校验 | 公开 | trim 后非空；Agent 构造不统一小写；:43 |
| `name` | `string?` | `id` | 调用方 | 公开 | 空字符串同样回退；:50 |
| `description` | `string?` | `""` | 调用方 | 公开 | 展示、Group 调度，不替代 instruction；:57 |
| `tools` | `Record<string, AgentTool>?` | `{}` | 调用方 | 公开扩展 | 与 Workspace、Power 合并，重名失败；:66、[Agent.ts:482](../packages/agent/src/agent/Agent.ts#L482) |
| `hooks` | `ToolHookSet?` | 空 hooks | 调用方 | 扩展端口 | 容器在前、自有在后；:75、[Agent.ts:593](../packages/agent/src/agent/Agent.ts#L593) |
| `instruction` | `string \| string[]?` | 归一化后 `[]` | 调用方 | 公开 | SDK core 始终另行保留，不是仅未传时 fallback；:85、[AgentInstructions.ts:68](../packages/agent/src/agent/AgentInstructions.ts#L68) |
| `model` | `ModelClient?` | `undefined` | 宿主 | 公开 | Session 模型回退来源；缺模型允许构造，执行时报错；:94、[StepInput.ts:118](../packages/agent/src/session/input/StepInput.ts#L118) |
| `workspace` | `WorkspaceRuntime?` | `undefined` | 宿主 | 公开 | 职责为新建默认目录；恢复例外疑点见 §6；:104 |
| `resolve_work_workspace` | `(workspace_id: string) => Promise<WorkspaceRuntime>` 可选 | 无显式端口时工作路径可回退容器 resolver | 宿主 | 扩展端口 | 不应写成“未提供必然不能派发”；:112、[Agent.ts:540](../packages/agent/src/agent/Agent.ts#L540) |
| `prepare_work_session` | `(session: AgentSession, model_id?: string) => Promise<void>` 可选 | `undefined` | 宿主 | 扩展端口 | 幂等恢复模型/订阅，不得再次派发；:120 |
| `resolve_work_model` | `(model_id: string, workspace?: WorkspaceRuntime) => Promise<ModelClient>` 可选 | `undefined` | 宿主 | 扩展端口 | 显式工作模型选择依赖此端口；:123、[Agent.ts:551](../packages/agent/src/agent/Agent.ts#L551) |
| `session_class` | `AgentSessionConstructor?` | `Session` | 调用方 | 扩展端口 | 本地构造类；:133 |
| `session_composer` | `SessionComposer?` | `DefaultSessionComposer` | 调用方 | 扩展端口 | Agent 全部 Session 共享，要求无状态；:143 |
| `callbacks` | `SessionCallbacks?` | `{}` | 调用方 | 扩展端口 | 编译到 turn_committed hooks；handler_id 稳定唯一；:35、[Agent.ts:154](../packages/agent/src/agent/Agent.ts#L154) |

#### 2.2 SessionOptions：全部 22 个字段

这是本地 Session 类的装配协议，不是 SDK 用户每次 create 要填写的业务参数。定义见 [SessionOptions.ts:53](../packages/agent/src/types/session/SessionOptions.ts#L53)，装配见 [AgentSessions.ts:577](../packages/agent/src/agent/AgentSessions.ts#L577)。下表行号均指 SessionOptions.ts。

| 字段 | 类型 | 默认值 | 归属层 | 是否稳定 | 备注 / 定义行 |
| --- | --- | --- | --- | --- | --- |
| `agent_id` | `string` | — | SDK core | 装配协议 | 所属 Agent；:63 |
| `get_agent_name` | `() => string` | — | SDK core | 装配协议 | 实时身份；:66 |
| `get_agent_description` | `() => string` | — | SDK core | 装配协议 | 实时描述；:69 |
| `workspace` | `WorkspaceRuntime?` | `undefined` | 宿主 | 装配协议 | 初始运行时资源；:77 |
| `workspace_path` | `string` | —；集合无目录传 `"."` | SDK core | 装配协议 | 展示回退路径，不授予文件权限；:80、[Agent.ts:196](../packages/agent/src/agent/Agent.ts#L196) |
| `origin` | `SessionOrigin` | — | 调用方；core 规范化 | 装配协议 | 分类、角色、JSON 元数据；:83 |
| `store` | `SessionStorage` | — | SDK core | 装配协议 | 单会话领域视图；:86 |
| `create_session_store` | `(session_id: string) => SessionStorage` | — | SDK core | 装配协议 | fork 使用；:89 |
| `allocate_session_id` | `() => Promise<string>` 可选 | 独立 Session fork 可用随机 ID | SDK core | 装配协议 | 集合注入带碰撞检查的分配器；:92、[Session.ts:616](../packages/agent/src/session/Session.ts#L616) |
| `register_forked_session` | `(session: AgentManagedSession) => void` | — | SDK core | 装配协议 | 唯一集合接管 fork；:101 |
| `session_id` | `string` | — | SDK core | 装配协议 | 集合先分配；:106 |
| `get_tools` | `() => Record<string, AgentTool>` | — | SDK core | 装配协议 | 每 Step 读取；:109 |
| `logger` | `Logger` | — | SDK core | 装配协议 | 统一日志；:113 |
| `instruction_system_blocks` | `AgentSessionSystemBlock[]` | — | SDK core | 装配协议 | 创建时捕获；:122 |
| `get_instruction_system_blocks` | `() => AgentSessionSystemBlock[]` | — | SDK core | 装配协议 | syncshot 刷新来源；:131 |
| `get_workspace` | `() => WorkspaceRuntime \| undefined` | — | SDK core | 装配协议 | 目录 getter；:134 |
| `get_hooks` | `() => ToolHookSet` | — | SDK core | 装配协议 | 每 Step 读取；:137 |
| `get_agent_model` | `() => ModelClient \| undefined` | — | SDK core | 装配协议 | 默认模型；:141 |
| `composer` | `SessionComposer?` | 集合传默认 Composer | 调用方 | 扩展端口 | Agent 共享；:148 |
| `completions` | `SessionCompletionPort?` | `undefined` | SDK core | 装配协议 | 完成事件写前日志；:55 |
| `child_work` | `SessionChildWork?` | `undefined` | SDK core | 装配协议 | 父 Turn 等待/取消子工作；:57 |
| `archive_session` | `(session_id: string) => Promise<AgentArchiveSessionResult>` 可选 | `undefined` | SDK core | 装配协议 | 归档交回拥有者；:59 |

#### 2.3 相邻对外参数

范围是直接影响身份、资源、权限与输入的参数；普通历史分页和归档结果不逐字段展开。集合公共窄接口与本地实现不同，不能从本地实例参数推断远程可传 Workspace 对象。[SessionActor.ts:56](../packages/agent/src/types/agent/SessionActor.ts#L56)

| 字段 / 入口 | 类型 | 默认值 | 归属层 | 是否稳定 | 备注 / 证据 |
| --- | --- | --- | --- | --- | --- |
| `self({ workspace })` | `WorkspaceRuntime?` | 新建用 Agent 默认目录 | 宿主 | 本地公开 | 仅首次创建注入；已有会话忽略此次参数；[AgentSessions.ts:251](../packages/agent/src/agent/AgentSessions.ts#L251) |
| `create.origin` | `SessionOrigin?` | `{category:"work",type:"work"}` | 调用方 | 公开 | 集合生成 ID；[SessionTypes.ts:24](../packages/agent/src/types/agent/SessionTypes.ts#L24) |
| 本地 `create.workspace` | `WorkspaceRuntime?` | Agent 默认目录 | 宿主 | 本地公开 | 本地实现额外接受；[AgentSessions.ts:310](../packages/agent/src/agent/AgentSessions.ts#L310) |
| `get(session_id, category, {workspace})` | `string, string?, 本地实例?` | category=`work`；workspace 未传 | 宿主 | 公开 / 本地注入 | 第二参数是 category，不能传 agent/task/group；[AgentSessions.ts:380](../packages/agent/src/agent/AgentSessions.ts#L380) |
| `origin.category` | `"chat" \| "work"` | 已知 type 运行时可推断 | SDK core | 公开身份规则 | 类型要求提供；运行时允许已知 type 缺省；[SessionOrigin.ts:73](../packages/type/src/types/session/SessionOrigin.ts#L73)、:129 |
| `origin.type` | `string` | 整个 origin 缺省时 `work` | 调用方 | 公开开放值 | trim 非空，不是六值 enum；SessionOrigin.ts:112、:152 |
| `origin[其他键]` | `JsonValue` | 无 | 调用方 | 创建方协议 | JSON 序列化后持久化；SessionOrigin.ts:90、:152 |
| `list.category / origin_type / workspace_id` | 各为 `string?` | `work` / 不过滤 / 不过滤 | 调用方 | 公开 | category 定位，type 区内过滤，workspace 元数据过滤；[SessionTypes.ts:37](../packages/agent/src/types/agent/SessionTypes.ts#L37) |
| `list.limit / cursor / query` | `number? / string? / string?` | 存储实现默认 / 无 / 无 | 调用方 | 公开 | cursor 只透传；此处不承诺固定默认限额；SessionTypes.ts:54 |
| `set.model` | `ModelClient?` | 保持当前 | 宿主 | 本地公开 | 模型选择与恢复由宿主负责；SessionTypes.ts:85 |
| `set.workspace` | `WorkspaceRuntime \| null` 可选 | 保持当前 | 宿主 | 本地公开 | null 脱离目录；ID 持久化；SessionTypes.ts:106 |
| `set.security.approval_mode` | `"ask" \| "always-allow"` | 新 Session `ask` | 宿主 | 公开 | configured / effective 区分；[Session.ts:110](../packages/agent/src/session/Session.ts#L110)、:342 |
| `set.options.persist_action / publish_mutation` | `boolean? / boolean?` | true / 跟随 persist_action | 宿主 | 公开 | 后者不可在前者 false 时为 true；[SessionTypes.ts:120](../packages/agent/src/types/agent/SessionTypes.ts#L120) |
| 远程 `set.model_id / security` | `string? / AgentSessionSecurityConfig?` | 保持当前 | 宿主 | 远程公开 | 不传 ModelClient/Workspace 对象；SessionTypes.ts:144 |
| `prompt.query` | `string \| SessionUserContent[]` | — | 调用方 | 公开 | 本次新增输入；[AgentSessionPrompt.ts:43](../packages/agent/src/types/sdk/AgentSessionPrompt.ts#L43) |
| `prompt.actor` | `SessionPromptActor?` | 本地用户 | 宿主 | 公开身份规则 | 自动执行必须显式声明，不等于 origin；AgentSessionPrompt.ts:48 |
| `prompt.request_id / callback` | `string? / SessionCallback?` | 无 | 调用方 | 公开 | callback 需非空 request_id；AgentSessionPrompt.ts:54 |
| `prompt.visibility` | `"visible" \| "internal"` 可选 | `visible` | 调用方 | 公开 | internal 仍入模型、落盘，不提升权限；AgentSessionPrompt.ts:70 |
| `prompt.abort_signal` | `AbortSignal?` | 无 | 宿主 | 本地公开 | 取消接收，不替代 stop；AgentSessionPrompt.ts:45 |
| `prompt.powers` | `readonly PromptPower[]?` | 无 | 调用方 | 扩展端口 | 新 Turn 装配，追加输入不能替换；AgentSessionPrompt.ts:47 |
| `session.start.workspace_id / query` | 各为非空 `string` | — | 调用方；宿主解析 | Power 公开 | 必须显式指定项目；[SessionDelegations.ts:63](../packages/agent/src/agent/SessionDelegations.ts#L63) |
| `session.start.model_id / title` | `string? / string?` | 无显式选择 / 无 | 调用方；宿主解析模型 | Power 公开 | 显式 model_id 需 resolver；SessionDelegations.ts:72、:87 |

### 3. 来源分区与身份规则权威表

物理路径以 Agent 存储根 `R` 为基准：活动库 `R/sessions/<category>/<encoded_session_id>/session.db`，归档库 `R/archived-sessions/<category>/<encoded_session_id>/session.db`。编码可逆并处理 Windows 保留设备名，type 不拼入目录。[LocalStorePaths.ts:15](../packages/agent/src/session/storage/LocalStorePaths.ts#L15)、[:70](../packages/agent/src/session/storage/LocalStorePaths.ts#L70)

| type 值 | 定义位置 | session_id 规则 | 物理分区 | 创建入口与实际使用范围 |
| --- | --- | --- | --- | --- |
| `agent` | [SessionOrigin.ts:27](../packages/type/src/types/session/SessionOrigin.ts#L27) | self 使用 trim 后小写的 Agent ID | `chat` | [AgentSessions.self:251](../packages/agent/src/agent/AgentSessions.ts#L251)、[AgentSessionIdentity.ts:29](../packages/agent/src/agent/AgentSessionIdentity.ts#L29)；Agent 主对话，集合串行惰性创建 |
| `channel` | [SessionOrigin.ts:30](../packages/type/src/types/session/SessionOrigin.ts#L30) | 集合生成随机短 ID，不是外部 chat_id；Store 保存路由映射 | `chat` | [MessengerRuntime.ts:119](../packages/implementations/powers/src/messenger/runtime/MessengerRuntime.ts#L119)、[:470](../packages/implementations/powers/src/messenger/runtime/MessengerRuntime.ts#L470)、[:564](../packages/implementations/powers/src/messenger/runtime/MessengerRuntime.ts#L564)；入站、升级、重绑定外部聊天；[MessengerAccountHostActions.ts:197](../packages/implementations/powers/src/messenger/host/MessengerAccountHostActions.ts#L197) |
| `group` | [SessionOrigin.ts:33](../packages/type/src/types/session/SessionOrigin.ts#L33) | 集合生成；Group 保存成员 ID 映射 | `chat` | [GroupSession.ts:498](../packages/agent/src/group/GroupSession.ts#L498)；每个 GroupSession 的 Agent 成员会话；:517 恢复检查 type/group_id/group_session_id |
| `chrome` | [SessionOrigin.ts:36](../packages/type/src/types/session/SessionOrigin.ts#L36) | 服务端集合生成；扩展按连接 scope 存本机引用，不是 tab ID | `chat` | [cityClient.ts:81](../../private/apps/chrome-extension/src/services/cityClient.ts#L81) 实际传 chrome/chat，恢复传 chat；popup/侧栏共享引用 |
| `work` | [SessionOrigin.ts:39](../packages/type/src/types/session/SessionOrigin.ts#L39) | 普通 create 分配短 ID；委派先在记录预分配 ID，再幂等 ensure | `work` | [AgentSessions.ts:310](../packages/agent/src/agent/AgentSessions.ts#L310)、[:324](../packages/agent/src/agent/AgentSessions.ts#L324)、[SessionDelegations.ts:56](../packages/agent/src/agent/SessionDelegations.ts#L56)；默认 SDK 工作及 session.start 子工作 |
| `task` | [SessionOrigin.ts:42](../packages/type/src/types/session/SessionOrigin.ts#L42) | 集合生成物理 ID；runSessionId / userSimulatorSessionId 是 Task 内别名 | `work` | [TaskRunnerSession.ts:43](../packages/implementations/powers/src/task/runtime/TaskRunnerSession.ts#L43) 创建 executor 与 user_simulator，附 task_id/execution_id/role；:63 映射别名 |
| 自定义非空字符串 | [SessionOrigin.ts:84](../packages/type/src/types/session/SessionOrigin.ts#L84) | 走集合则遵守通用规则 | 必须显式 chat/work | SDK、Power bridge、远程创建可透传；当前扫描未确认第七个生产角色，不推断第三方不存在 |

统一身份规则：

1. 完整寻址为 **Agent + category + normalized session_id**。同 Agent 的 chat/x 与 work/x 可并存；同 category 下不同 type 不能靠 type 区分同名 ID。[AgentSessions.ts:640](../packages/agent/src/agent/AgentSessions.ts#L640)、[LocalSessionStore.ts:110](../packages/agent/src/session/storage/LocalSessionStore.ts#L110)
2. 集合分配器使用 12 位无歧义小写随机字符，最多尝试 100 次，并检查预留/存储。委派先生成 ID 再记记录，不应声称所有入口都经过相同碰撞检查。[SessionIdentity.ts:7](../packages/agent/src/session/SessionIdentity.ts#L7)、[AgentSessions.ts:650](../packages/agent/src/agent/AgentSessions.ts#L650)、[SessionDelegations.ts:59](../packages/agent/src/agent/SessionDelegations.ts#L59)
3. 恢复以数据库完整 origin 为事实，校验 category 与分区、所属 Agent；workspace_id 不参与身份相等校验。[LocalSessionStore.ts:142](../packages/agent/src/session/storage/LocalSessionStore.ts#L142)、[SessionOrigin.ts:247](../packages/type/src/types/session/SessionOrigin.ts#L247)
4. self 的单例只覆盖该入口；通用 create 未禁止 type=agent，仍会生成随机 ID。因此“所有 agent 类型记录全局唯一且 ID 恒等原 Agent ID”不是现有强制不变量。[AgentSessions.ts:251](../packages/agent/src/agent/AgentSessions.ts#L251)、[:310](../packages/agent/src/agent/AgentSessions.ts#L310)
5. chat 当前是 category，不是已知 type；开放字符串仍允许显式 type=chat 加 category，但该自定义角色不会自动获得已知 Chat 委派资格。[SessionOrigin.ts:208](../packages/type/src/types/session/SessionOrigin.ts#L208)

动态入口追踪：RPC/HTTP 创建最终调用集合；Power bridge 传入 origin 与 Workspace；系统级 create_agent_session 同样调用 Agent 集合。这些没有另建一套 Session 存储。[SdkSessionHandlers.ts:88](../packages/city/src/city/transport/rpc/server/SdkSessionHandlers.ts#L88)、[SessionRoutes.ts:77](../packages/city/src/city/transport/http/routes/SessionRoutes.ts#L77)、[PowerSessionBridge.ts:71](../packages/city/src/city/power/PowerSessionBridge.ts#L71)、[CityPowerRuntime.ts:764](../packages/city/src/city/power/CityPowerRuntime.ts#L764)

委派 origin 由 create_work_origin 固定生成 work/work，父 Agent、父 category、父 Session、根 Chat 和深度是元数据；拼接出的 delegation_id 不是新 type。Messenger 的 conversation_origin 固定 channel，动态字段为渠道/账号/聊天信息，Telegram 等 provider 不是 type。[SessionWorkPolicy.ts:42](../packages/agent/src/agent/SessionWorkPolicy.ts#L42)、[SessionDelegations.ts:76](../packages/agent/src/agent/SessionDelegations.ts#L76)、[MessengerAccountHostActions.ts:383](../packages/implementations/powers/src/messenger/host/MessengerAccountHostActions.ts#L383)

旧库存在分类迁移器；迁移处理不能当作给历史自定义字符串授予正式角色资格。[OriginCategoryMigration.ts:186](../packages/agent/src/session/storage/OriginCategoryMigration.ts#L186)

### 4. 能力边界矩阵

#### 4.1 公共装配与矩阵符号

没有按 type 分发的一份全局工具白名单。基础工具是 Workspace.tools + City.power_tools + AgentOptions.tools，重名失败；StepInput 每步读取，再追加本 Turn 的 Prompt Powers。Registry 遍历已注册 Power，各 Power 自行编译工具。可见入口、执行授权、资源可用性必须分别判断。[Agent.ts:482](../packages/agent/src/agent/Agent.ts#L482)、[StepInput.ts:291](../packages/agent/src/session/input/StepInput.ts#L291)、[PowerRegistry.ts:116](../packages/city/src/power/core/PowerRegistry.ts#L116)

- **T**：Agent 自定义工具、已注入 Workspace 的工具、本 Turn Prompt Powers。标准 Workspace 提供文件/搜索，Shell 只以 Power 暴露；自定义 Workspace 可以不同。[WorkspaceTools.ts:18](../packages/city/src/workspace/tool/WorkspaceTools.ts#L18)、[Workspace.ts:72](../packages/city/src/workspace/Workspace.ts#L72)
- **P**：当前 City 注册且编译可见的 Power；独立 SDK Agent 不自动拥有 City Power。City 装配内置 context/ai/agent/session 与 shell，宿主还可增减。memory/web/mcp/task 等不能写成所有 SDK Session 必有。[City.ts:118](../packages/city/src/city/runtime/City.ts#L118)、[:204](../packages/city/src/city/runtime/City.ts#L204)、[CityPowerRuntime.ts:396](../packages/city/src/city/power/CityPowerRuntime.ts#L396)
- **S**：身份 + 调用方 instruction + SDK core，经 Composer 加 Session facts、Power system。安装 MemoryPower 时读 User 与当前 Agent Profile，不是按六个 type 维护六套 profile。完整 system 首次组装冻结，syncshot 刷新；自定义 Composer/Power 可改变内容。[AgentInstructions.ts:68](../packages/agent/src/agent/AgentInstructions.ts#L68)、[StepInput.ts:146](../packages/agent/src/session/input/StepInput.ts#L146)、[MemoryPower.ts:225](../packages/implementations/powers/src/memory/MemoryPower.ts#L225)
- **A**：自身 Session 的交互/审批端口，默认 ask，可配置 always-allow。Power 的 access=write 不等于请求审批；approval=true 才进入统一审批。需要审批却缺端口或 Tool Call 身份时明确失败。[Session.ts:110](../packages/agent/src/session/Session.ts#L110)、[PowerActionApproval.ts:31](../packages/city/src/power/core/PowerActionApproval.ts#L31)、[PowerActionExecution.ts:145](../packages/city/src/power/core/PowerActionExecution.ts#L145)

| 来源类型 | 工具组 | Power 与协作权限 | Workspace 权限 | system prompt / profile | 审批范围 |
| --- | --- | --- | --- | --- | --- |
| agent / chat | T | P；可读本 Agent 活动和归档历史；深度 0 可建多个一级 Work | 宿主注入；主目录不自动作为派发项目默认值 | S | A；session.reply 不能批准子会话操作 |
| channel / chat | T | P；同已知 Chat 派发规则；Messenger 完成 hook 对此角色输出外部回复 | 系统创建/恢复入口与宿主决定，角色不扩大授权 | S + Messenger 上下文 | A；外部回复能力不授予审批权 |
| group / chat | T | P；同已知 Chat 派发规则；Group 管理成员消息投影 | Group 显式 Workspace 注入成员 | S；协作语义另由 Group 输入提供 | A；Group 转发成员交互，状态仍归成员 |
| chrome / chat | T | P；同已知 Chat 派发规则；名字不自动授予浏览器工具 | 扩展未直接传实例，服务端宿主装配决定 | S；可由调用方按 Turn 传 Prompt Powers | A；来源不免审批 |
| work 一级 / work | T | P；可读本 Agent 历史；可创建多个子会话，支持并行，仅控制直接 Work 子会话 | start 必须指定项目 ID，经宿主解析；普通 SDK create 允许无目录 | S；不假定复制父 system 快照 | A；控制动作另验直接父子关系 |
| work 二级 / work | T | P 入口仍可见；禁止再创建，历史读取保留 | 派发记录指定项目资源 | S | A；读取交互不授予回答或审批权 |
| task / work | T | P；无论深度都禁止派发；历史读取保留 | 从 Power bridge 当前 Workspace 装配 | S；符合条件可继承模型，不是完整 system 继承 | A；无人响应不代表放行 |
| 自定义 type | T | P；可读本 Agent 历史；未知角色禁止派发，即使 category=chat | 宿主注入资源 | S；无自动新角色 profile | A；无隐含特权 |

派发资格来自已知角色、深度、父子关系三者：Chat 深度 0，普通无父 Work 默认 1，上限 **2**；Task 一律禁止，自定义角色不自动允许。Chat 和一级 Work 不设子会话数量或并发上限；持久化创建保留幂等与父 Turn 封闭检查。[SessionOrigin.ts:44](../packages/type/src/types/session/SessionOrigin.ts#L44)、[:185](../packages/type/src/types/session/SessionOrigin.ts#L185)、[:205](../packages/type/src/types/session/SessionOrigin.ts#L205)、[SessionDelegations.ts:94](../packages/agent/src/agent/SessionDelegations.ts#L94)、[LocalSessionDelegationStore.ts:26](../packages/agent/src/agent/LocalSessionDelegationStore.ts#L26)

所有类型可读本 Agent 历史、禁止读取别的 Agent；写操作要求直接普通 Work 子会话，不能只凭同 Agent 放行。reply 不允许批准操作。[SessionPower.ts:27](../packages/city/src/city/power/builtin/session/SessionPower.ts#L27)、[:78](../packages/city/src/city/power/builtin/session/SessionPower.ts#L78)、[SessionWorkPolicy.ts:25](../packages/agent/src/agent/SessionWorkPolicy.ts#L25)、[SessionWork.ts:195](../packages/agent/src/agent/SessionWork.ts#L195)

渠道完成 hook、Group 转发和 Task 模型继承分别见 [MessengerPower.ts:37](../packages/implementations/powers/src/messenger/MessengerPower.ts#L37)、[GroupSession.ts:523](../packages/agent/src/group/GroupSession.ts#L523)、[TaskRunnerSession.ts:35](../packages/implementations/powers/src/task/runtime/TaskRunnerSession.ts#L35)。不能将 Task 的 executor/user_simulator 元数据差异解读成独立权限豁免。

#### 4.2 指令、Profile 与资源权限

CityPowerRuntime 的 agent_instructions 装配为 StepSnapshot.agent_systems，优先取调用点本步快照，回退 Agent 当前 instruction；它不是另一条按 type 授权工具的路径。[CityPowerRuntime.ts:485](../packages/city/src/city/power/CityPowerRuntime.ts#L485)

Profile 由 MemoryPower 的 system_context hook 读取；动态参考内容走 turn_context，再由 Composer 注入低权限 reference 区。system 中“允许/禁止”的文字不能代替执行授权。[MemoryPower.ts:225](../packages/implementations/powers/src/memory/MemoryPower.ts#L225)、[ComposerAssembly.ts:44](../packages/agent/src/session/input/composer/ComposerAssembly.ts#L44)

标准文件权限依实际 FileSystem 的根与挂载；Shell 取 context.workspace.shell，无该实例不能执行 Shell。主机执行具体审批还依赖 Shell 与宿主端口，不能仅凭 prompt 的提示句断言已经执行审批。[Workspace.ts:82](../packages/city/src/workspace/Workspace.ts#L82)、[ShellPower.ts:163](../packages/city/src/city/power/builtin/shell/ShellPower.ts#L163)

### 5. 旧设计稿实际落地判定

原始主张见 [agent-chat-design.md:19](./agent-chat-design.md#L19)、[:39](./agent-chat-design.md#L39)、[:51](./agent-chat-design.md#L51)、[:245](./agent-chat-design.md#L245)。

| 主张 | 判定 | 当前实现与理由 |
| --- | --- | --- |
| workspace_id 不应作为 get 的身份强校验 | **采纳** | 普通 get 接受显式实例与 persisted ID 不同，调用 set 更新，无原先相等拒绝。[AgentSessions.ts:404](../packages/agent/src/agent/AgentSessions.ts#L404) |
| 实例由宿主注入，Agent 不解析 Workspace | **部分采纳** | 普通 get 不按 persisted ID 查 City；工作恢复却读 ID 并调用宿主/容器 resolver，失败会抛错；不能推广成所有路径都静默无目录继续。[Agent.ts:524](../packages/agent/src/agent/Agent.ts#L524)、[:540](../packages/agent/src/agent/Agent.ts#L540) |
| 用 work 取代默认 chat | **部分采纳** | 默认角色为 work 已实现；chat 仍是有效顶层分类，若解释为删除 chat 概念则已放弃。[SessionOrigin.ts:20](../packages/type/src/types/session/SessionOrigin.ts#L20)、[:152](../packages/type/src/types/session/SessionOrigin.ts#L152) |
| type 同时承担角色和物理分区，无需新字段 | **放弃** | category 新增并承载两分区。[SessionOrigin.ts:73](../packages/type/src/types/session/SessionOrigin.ts#L73)、[LocalStorePaths.ts:51](../packages/agent/src/session/storage/LocalStorePaths.ts#L51) |
| get(id, "agent") 取得主会话 | **放弃** | 第二参数改为 category，应传 chat 或使用 self。[AgentSessions.ts:380](../packages/agent/src/agent/AgentSessions.ts#L380) |
| Agent 自身也是普通 Session，ID 就是 Agent ID，至多一条 | **部分采纳** | self 已有，但 ID 小写归一化，通用 create 未禁止第二条 agent 角色；见 §3 |
| 所有 Session 共用机制与能力 | **部分采纳** | 装配机制共用，Task、二级 Work、自定义角色委派权限不同。[SessionOrigin.ts:205](../packages/type/src/types/session/SessionOrigin.ts#L205) |
| set/get 收敛，删除 workspace_id 属性/get_workspace | **部分采纳** | set/get 已有，属性和方法仍存在。[SessionActor.ts:82](../packages/agent/src/types/agent/SessionActor.ts#L82)、[Session.ts:599](../packages/agent/src/session/Session.ts#L599) |
| 跨渠道同 Agent、同一段对话 | **部分采纳** | Agent 可以相同，但 channel Session 独立创建，旧 Work 历史保留，不自动与 self 合并。[MessengerRuntime.ts:114](../packages/implementations/powers/src/messenger/runtime/MessengerRuntime.ts#L114) |

不能把旧设计稿整体改标为“全部已实施”，也不能把跨会话 reply 等同于代用户批准操作。

### 6. 不一致与待验证疑点

**确认的不一致：**

- 旧边界文件“上限 3、任何会话都可派发、审批可经 session.reply 回传”“只有三个常量”均不符合当前分支；当前为上限 2、Task/未知角色禁止、reply 不批准、六常量。证据见 §1、§4。
- AgentOptions.instruction 注释把 core 称为缺省 fallback，创建函数始终保留 core；行为以函数为准。SessionOptions 开头还称 Composer 为 Session 级，字段说明与集合实现明确 Agent 共享。[AgentOptions.ts:79](../packages/agent/src/types/agent/AgentOptions.ts#L79)、[AgentInstructions.ts:68](../packages/agent/src/agent/AgentInstructions.ts#L68)、[SessionOptions.ts:1](../packages/agent/src/types/session/SessionOptions.ts#L1)、[AgentSessions.ts:133](../packages/agent/src/agent/AgentSessions.ts#L133)
- get 注释称省略 Workspace “沿用持久化值”，正文只读 ID，不按其还原实例；ID 与执行资源要分开描述。[AgentSessions.ts:374](../packages/agent/src/agent/AgentSessions.ts#L374)、[:404](../packages/agent/src/agent/AgentSessions.ts#L404)
- AgentSessionIdentity 注释称能力由分类决定，但自定义 chat 角色被委派策略拒绝；还依赖 type、深度与关系。[AgentSessionIdentity.ts:13](../packages/agent/src/agent/AgentSessionIdentity.ts#L13)、[SessionOrigin.ts:211](../packages/type/src/types/session/SessionOrigin.ts#L211)

**静态疑点，未运行验证：**

1. **恢复可能继承 Agent 默认目录。** get 调 get_or_create_session，后者始终向 resolve_session_context 传 creating:true；Agent 据此回退默认 workspace。这与“默认目录不参与恢复”冲突。未缓存、未传实例、Agent 有默认目录这一组合，不能承诺必定无项目。[AgentSessions.ts:409](../packages/agent/src/agent/AgentSessions.ts#L409)、[:572](../packages/agent/src/agent/AgentSessions.ts#L572)、[Agent.ts:193](../packages/agent/src/agent/Agent.ts#L193)
2. **切目录后静态工具可能仍绑定旧资源。** Session 的 get_tools 捕获初始 context，context 又捕获初始 workspace；set 更新 current_workspace/ID，StepInput 仍调用原 getter。新动态上下文不足以证明文件工具已换根，需核实 A→B、A→null、无目录→B。[AgentSessions.ts:589](../packages/agent/src/agent/AgentSessions.ts#L589)、[Agent.ts:214](../packages/agent/src/agent/Agent.ts#L214)、[Session.ts:363](../packages/agent/src/session/Session.ts#L363)、[StepInput.ts:291](../packages/agent/src/session/input/StepInput.ts#L291)
3. **Power bridge runtime 句柄角色可能不准确。** runtime 返回句柄时写 type=work，Task 经该入口取端口。需检查使用者是否依赖句柄 origin；不能直接声称真实 Task 执行身份变成 work，Session 本身仍持 task origin。[PowerSessionBridge.ts:86](../packages/city/src/city/power/PowerSessionBridge.ts#L86)、[TaskRunnerSession.ts:63](../packages/implementations/powers/src/task/runtime/TaskRunnerSession.ts#L63)、[Session.ts:143](../packages/agent/src/session/Session.ts#L143)

未读取真实用户会话库，未启动 Session 或动态插件；上述项目不是已证实的线上故障。

## 二、建议收敛（未实施）

### 7. 建议固定的契约

1. 身份固定为 Agent + category + normalized session_id，Workspace 是可变执行资源；文档淘汰 get(id,type) 的旧表述。
2. 保留开放 type，具体 action 从可信调用身份、角色、深度、关系和资源联合授权。category=chat 本身不等于自定义角色获准委派。
3. 后续经批准的代码工作统一目录事实源：明确创建/恢复，工具按当前 Session Workspace 在检查点解析，同时解决 §6 前两项，避免仅改注释。
4. 宿主预装能力与 SDK core 分开记录；动态插件可用性由 registry、action 策略和凭证决定，不冻结为永久全集。
5. 本文承担边界定义，runtime 文档承担机制，旧设计/旧边界文档保留历史并指向最终权威。旧文档的修改留给单独批准的文档整合。

这些建议源于 §3 身份事实、§4 动态装配和 §6 疑点；本次不实施任何建议。

### 8. 需要用户决策的开放问题

| 问题 | 选项 | 推荐与理由 | 影响 |
| --- | --- | --- | --- |
| type 是否继续开放？ | A 开放字符串+显式 category；B 封闭六值；C 新增角色注册表 | **A**。保留最小扩展面，有真实自定义授权需求后再考虑注册表 | 影响第三方 API，未决前沿用当前 |
| agent 角色是否全入口唯一？ | A 仅 self 保证；B 保留该角色、禁止通用 create 随机 ID | **B**。符合“Agent 自己那条会话”的语义 | 需定义创建错误与历史异常记录处理 |
| Agent ID 是否统一小写？ | A 全局规范化并定义冲突；B 保留现状，明确 self ID 是 normalized ID | **B（当前冻结）**。先准确记录；全局主体标识变更需独立设计 | registry、路径、外部引用 |
| Workspace 恢复失败如何处理？ | A 普通 get 可无目录，明确项目工作失败；B 全部静默降级；C 全部拒绝 | **A**。历史可访问，项目工作不能在错误目录继续；先验证 §6 | 恢复、重试、用户可见错误 |
| 是否优先核实目录切换？ | A 同时核实并修复恢复/工具重绑定；B 只改文档；C 禁止切目录 | **A**。set 已公开，资源事实源应一致 | 本次仅记录，修复需另行批准 |
| 每类是否固定工具白名单？ | A 动态注册+action 授权；B 按 type 白名单 | **A**。当前差异主要在协作与资源，固定全集会与扩展脱节 | 选 B 需定义 Prompt Powers、宿主、自定义角色优先级 |
| Task 是否独立预授权？ | A 统一审批，缺端口失败；B 建立自动任务预授权策略 | **A**。不能仅凭 task 来源获得批准权；明确无人值守需求后再设计 B | 不改变现有宿主配置 |
| 最终文档如何整合？ | A 将本次核定内容合入 session-agent-boundary.md，本文随后退役；B 保留本文，旧边界文件标历史；C 两份都保留权威 | **A**。最终回到建议路径并避免两个权威；本次先保留既有文件原貌 | 需用户批准后续整合；C 不推荐 |

### 9. 维护与验证范围

本次验证限于静态源码、创建与消费链、文档字段和证据链接；不新增测试、不执行会话、不做迁移、不提交。后续新增角色、参数、工具注入或权限规则时，应同步核对三张表。建议只有在决策、实现和验证后才能移入“当前实现”。
