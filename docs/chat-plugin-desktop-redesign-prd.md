# Chat Plugin Desktop 工作区与可靠消息运行时重设计

> 状态：已确认，进入实施
>
> 适用范围：`@downcity/city` Plugin Lifecycle、`@downcity/plugins` Chat Plugin、Desktop Plugin Renderer、Homepage 用户文档
>
> 更新时间：2026-09-10

## 1. 产品意图

Chat Plugin 是 Desktop 中独立的 Channel 管理工作区。它让用户添加和管理多个外部 Bot Account，把每个 Bot 收到的外部 Conversation 稳定地路由到指定 Agent、Workspace 与 Agent Session，并可靠地把 Agent 输出发送回原平台。

Chat Plugin 不属于 Agent。Agent 只拥有 Session 和 Turn；City 拥有唯一 Chat Plugin 实例及其长期网络连接、可靠收发状态和管理界面。

## 2. 产品界面

Chat Plugin 同时提供 Sidebar 和 Mainview，不再把 Bot Account 管理收缩在 Settings Config 页面。

### 2.1 Sidebar

Sidebar 的一级资源是 Bot Account，不是平台类型。列表允许存在多个相同平台的 Bot，例如两个 Telegram Bot。

每项至少展示：

- 用户定义的 Bot 名称。
- Telegram、Feishu 或 QQ 平台类型。
- `connected`、`connecting`、`disconnected`、`error` 或 `disabled` 状态。
- Pending Access 或待处理失败的提示。

Sidebar Header 通过加号提供添加入口，点击后在 Dropdown 中选择 Telegram、飞书/Lark 或 QQ，再进入对应平台的创建页面。Bot Account 菜单提供启用、停用、重连和删除。

### 2.2 Mainview

点击 Bot Account 后进入该 Account 的管理页面：

- `Overview`：连接状态、平台身份、默认 Agent/Workspace、最近收发时间与最近错误。
- `Routing`：选择默认 Agent 与 Workspace；新的外部 Conversation 继承该路由。
- `Access`：管理待审批、允许和拒绝的外部身份。
- `Conversations`：查看每个外部 Conversation 当前关联的 Agent、Workspace 和 Session。
- `Activity`：查看连接、准入、Turn 和投递事件，不复制完整 Session 对话历史。

创建 Bot 的流程为：选择平台、填写名称和凭据、选择 Agent/Workspace、测试连接、保存并启动。测试失败时允许保存为停用状态，不允许伪装成已连接。

## 3. 领域职责与所有权

```text
City
└── ChatPlugin
    ├── ChatStore
    ├── BotAccountRuntime[]
    │   └── ChatConnector
    ├── ChatInboxWorker
    └── ChatOutboxWorker

Agent
└── Session[]
    └── Turn[]
```

### 3.1 ChatPlugin

ChatPlugin 是一个 City 中全部 Chat 资源的唯一所有者，负责：

- 初始化和关闭 ChatStore。
- 根据持久化 Account 恢复 Bot Connector。
- 管理 Inbox 和 Outbox Worker。
- 注册 Desktop Host Actions 与 Agent Actions。
- 在单个 Account 变更时只重建该 Account 的 Runtime。

`system()` 只生成当前 Chat Session 的系统提示，不允许启动网络连接或创建长期资源。

### 3.2 BotAccount

BotAccount 表达一个真实的平台 Bot/App 账号，拥有：

- 稳定 `account_id`。
- 用户可见名称。
- Provider 类型和 Provider 配置。
- 启用状态。
- 默认 Agent 与 Workspace 路由。
- 凭据引用和运行状态。

Bot Account 不直接绑定一个共享 Session。否则不同外部用户和群会共享上下文。

### 3.3 Conversation

Conversation 由以下外部路由唯一确定：

```text
account_id + external_chat_id + chat_type + thread_id
```

每个 Conversation 绑定：

- 一个 Agent。
- 一个 Workspace。
- 该 Agent 持有的一个稳定 Session。

新 Conversation 继承 Account 默认路由。用户可在 Desktop 中改变单个 Conversation 的路由。更换 Agent 时必须创建或选择新 Agent 所拥有的 Session，不转移旧 Agent 的 Session 所有权。

### 3.4 Agent Session

Agent Session 是用户与 Agent 对话内容的唯一事实源，负责：

- canonical messages。
- Turn 串行与执行状态。
- 模型调用和工具执行。
- Session 持久化与恢复。

Chat Store 不维护第二份完整聊天历史。

## 4. 数据模型

Chat Plugin 在 Lifecycle Storage 中维护唯一 `chat.db`。Bot Account 定义与凭据统一保存在 City 提供的原子 Plugin Config 中，避免数据库与配置形成两个需要同步提交的事实源；`chat.db` 只保存 Conversation、可靠收发、Access 和 Activity。Host Action 只向 Renderer 投影 `credential_configured` 等非敏感字段。

### 4.1 Accounts

Account 使用 Plugin Config 中的 `accounts` 数组作为唯一事实源。每项包含稳定 ID、名称、Provider、启用状态、默认 Agent/Workspace、非敏感设置与平台凭据。配置必须整体校验后原子替换。

账号密钥不得出现在 Host Action Snapshot、Renderer State、Activity Event 或日志中。读取时只返回是否已配置。

### 4.2 Conversations

```text
chat_conversations
- conversation_id            primary key
- account_id                 foreign key
- external_chat_id
- chat_type
- thread_id
- title
- agent_id
- workspace_id
- session_id
- status                     active | paused
- last_message_at
- created_at
- updated_at
```

外部路由建立唯一索引。`session_id` 使用内部随机 ID，不从平台 ID 拼接。

### 4.3 Inbox

```text
chat_inbox
- inbound_id                 primary key
- account_id
- external_message_id
- conversation_id
- payload_json
- status                     received | pending | processing | processed | retry_wait | failed
- attempt_count
- available_at
- lease_expires_at
- error
- created_at
- updated_at
```

`account_id + external_message_id` 唯一，保证平台重复推送不会重复执行 Agent。

### 4.4 Outbox

```text
chat_outbox
- delivery_id                primary key
- account_id
- conversation_id
- operation                  text | attachment | reaction
- payload_json
- status                     pending | sending | retry_wait | delivered | failed
- attempt_count
- available_at
- lease_expires_at
- external_message_id
- error
- created_at
- updated_at
```

Agent Turn 成功与平台投递成功是两个独立事实。平台发送失败只重试 Outbox，不重新执行 Agent Turn。

### 4.5 Access 与 Activity

Access Principal 的唯一身份边界必须包含 `account_id`，避免同平台不同 Bot 共享授权。

Activity 只保存可诊断业务事件，不保存 Bot 密钥或完整消息正文。

## 5. 完整消息链路

```text
Platform Event
  → Connector normalize
  → Access decision
  → 允许的消息进入 Inbox 原子写入与幂等判断
  → Conversation resolve/create
  → Inbox Worker lease
  → 同 Conversation debounce merge
  → City prompt_agent_session
  → Agent Session Turn
  → Assistant completed message
  → Outbox 原子写入
  → Inbox processed
  → Outbox Worker lease
  → Connector send
  → delivered 或 retry_wait/failed
```

平台 Adapter 只负责协议转换和平台 API，不允许访问 Agent、Workspace、Session 或 Chat Store。

Access 位于 Inbox 之前：未授权消息的正文不进入可靠队列，减少不必要的敏感数据落盘。用户获批后需要重新发送消息；Inbox 的可靠性承诺从“已通过准入的消息”开始。

## 6. 可靠性语义

### 6.1 Inbox

- Connector 必须先完成 Access decision；允许的消息先持久化，再进入执行调度。
- Worker 通过有限时 lease 领取任务；进程退出后过期 lease 可以恢复。
- 同一 Conversation 同时最多一个 processing 批次。
- Session Prompt 使用 Inbox `inbound_id` 作为稳定 `request_id`。User Message 已落盘后进程退出，重试会复用同一 canonical Message 与 Turn；Turn 已完成而 Inbox 尚未提交时，重试直接读取原结果。
- Turn 生成的 Outbox 使用稳定 Delivery ID，避免崩溃恢复时重复建单。
- 不同 Conversation 按全局并发上限执行。
- Debounce 只合并尚未提交的连续消息，并真正形成一次 Session prompt。
- 超过重试上限进入 failed，由 Desktop 显示并允许人工重试。

### 6.2 Outbox

- 所有外发操作先持久化再调用平台。
- 使用指数退避和 Provider 返回的限流时间。
- 发送成功保存平台消息 ID。
- 延迟发送通过 `available_at` 表达，不使用长时间内存 `setTimeout`。
- City 重启后恢复 pending、retry_wait 和 lease 已过期的 sending 项。
- 平台没有幂等发送协议时提供 at-least-once，而不是虚假的 exactly-once：平台已接收但本地尚未记录确认的瞬间退出，恢复后可能再次发送。

### 6.3 配置与连接

- City 初始化时主动恢复所有 enabled Accounts。
- 单个 Account 配置改变只停止并重建对应 Connector。
- 一个 Connector 启动失败不得阻止其他 Account 启动。
- Runtime Status 是内存投影；Account 定义和消息状态以数据库为事实源。

### 6.4 关闭

关闭顺序为：

```text
停止接收新平台事件
→ 停止领取 Inbox/Outbox
→ 等待数据库事务完成
→ 释放或归还在途 lease
→ 取消订阅 Agent Turn
→ 停止 Connector
→ 关闭 ChatStore
```

## 7. City 最小能力

Plugin Lifecycle 必须提供两项稳定能力：

1. 读取和原子写入当前 Plugin 唯一配置，使长期运行 Plugin 不依赖 Config Action 的临时 Context。
2. 按 `agent_id + workspace_id + origin_type + session_id` 提交 Agent Session Turn，并返回可订阅、可等待、可停止的执行句柄。

ChatPlugin 不通过 `context.city.plugins.get("chat")` 反查自己，也不长期保存某次 Agent Action 的 `PluginContext`。

## 8. API 边界

### 8.1 Desktop Host Actions

- `accounts.snapshot`
- `accounts.create`
- `accounts.update`
- `accounts.delete`
- `accounts.status`
- `accounts.test`
- `accounts.restart`
- `conversations.list`
- `conversations.update_route`
- `conversations.reset_session`
- `inbox.retry`
- `outbox.retry`
- `access.snapshot`
- `access.approve`
- `access.deny`
- `access.set`
- `access.revoke`

这些能力只供 Desktop 或可信宿主管理入口，不暴露给模型。

### 8.2 Agent Actions

- `context`
- `send`
- `react`
- `list`
- `history`

Agent Action 只能访问当前 Agent 拥有的 Conversation；不允许仅凭任意 `session_id` 跨 Agent 发送。所有 Action 使用严格 Schema。

## 9. Desktop 状态刷新

Host Action mutation 成功后调用 Renderer `ui.invalidate()`。Connector 状态、Access Request、Inbox/Outbox 失败等异步变化通过 Plugin Notification 与 revision 驱动 Sidebar/Mainview 刷新，不让 Renderer 直接订阅内部 Runtime 对象。

## 10. 迁移原则

本次不保留旧配置和旧存储协议兼容层。迁移按以下顺序执行：

1. 扩展 Plugin Lifecycle Config 与 Agent Session Turn 能力。
2. 建立 ChatStore、Account、Conversation、Inbox、Outbox。
3. 用 City 生命周期驱动 ChatRuntime，删除 `system()` 启动副作用。
4. 将现有 Telegram、Feishu、QQ 实现收敛为 Account Connector。
5. 建立 Sidebar/Mainview 和 Host Actions。
6. 将 Access 从 Agent Action 移到 Host Action，并增加 Account 边界。
7. 删除旧内存 Queue、Chat History 和全局单 Account 配置。
8. 更新 Homepage 用户文档、测试、版本和构建产物。

## 11. 验收条件

- Desktop Sidebar 可以添加并展示多个同平台 Bot Account。
- 点击 Account 可以管理凭据、默认 Agent/Workspace、连接、Access 和 Conversations。
- City 启动后无需创建 Agent Session，enabled Account 即开始连接。
- 配置保存后只重启目标 Account，不重启 Desktop。
- 一个外部 Conversation 稳定对应一个 Agent Session。
- 重复平台消息不会重复执行 Agent。
- Desktop 在消息已入 Inbox 后退出，重启可以继续处理。
- Agent 已生成回复但平台发送失败时，重启可以继续投递且不重新执行 Agent。
- Agent Session 是完整对话内容的唯一事实源。
- 密钥不会通过 Renderer Snapshot、日志或 Agent Action 暴露。
- Plugin dispose 后不存在 Connector、Timer、Session Subscription 或数据库资源泄漏。
