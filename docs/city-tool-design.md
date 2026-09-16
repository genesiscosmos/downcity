# City Tool 设计：Agent 的运行时事实入口

Agent 能读项目文件、能执行命令、能通过 Plugin 访问外部系统，但有一类事实它只能靠猜：**我现在跑在哪个 Agent、哪个 Session、哪个 Workspace 下，沙箱里挂了什么，隔壁还有哪些 Agent**。这些事实只存在于 City 内部。

猜错的代价是具体的。沙箱只挂载 Workspace 目录，Agent 去读 Workspace 外的路径时，文件工具只回一句 `sandbox_denied`：它不知道是路径不存在、是只读，还是在挂载点之外，于是换个写法再试，几轮下来上下文烧掉了但问题没解决。

`city` 就是这块空白的出口。它不替代任何现有工具，只补齐「运行时自我认知」。

## 判断标准

一个能力该不该进 city tool，只看一条：**这件事是不是只有 harness 自己知道。**

| 能力 | 归属 | 为什么不进 city tool |
| --- | --- | --- |
| 读写项目文件 | 文件工具 | 有 Workspace 路径策略，是独立关注点 |
| 执行命令 | Shell 工具 | 另有执行后端选择与审批 |
| 收发消息、附件 | chat 插件 | 连接外部系统，账号级配置 |
| 定时任务 | task 插件 | 有独立的生命周期存储 |
| 凭据 | Plugin / Global Env | 归属在配置层，且敏感 |
| 插件调用 | `plugin_call` | 透传会绕掉现有 City 级 / Agent 级作用域模型 |

## 调用形状

一个工具，三层字段：

```jsonc
{ "namespace": "sandbox", "action": "explain_path", "args": { "path": "~/.downcity/plugins/chat" } }
```

不做成 N 个独立工具，是因为工具清单每轮都进 prompt，独立开工具会随能力增长持续膨胀，而且每加一个能力都要改工具签名。收成一个入口后，加 namespace 只加一个 provider 文件加一次注册。

省略参数的调用不报错，而是返回索引，省掉一轮试错：

| 调用 | 返回 |
| --- | --- |
| `city({})` | 当前 Agent 可见的 namespace 及一行摘要 |
| `city({ namespace: "sandbox" })` | 该 namespace 的动作、参数与返回结构 |
| `city({ namespace, action, args })` | 执行结果 |

工具描述从注册表派生，namespace 增减时模型侧描述自动跟上，不会与实现漂移。

## 第一期五个 namespace

全部只读。命名统一 snaker。

### `env`

Agent 对自身的认知：`agent_id`、`agent_name`、`session_id`、`turn_id`、`workspace_id`、`workspace_name`、`workspace_path`、`model_id`、`timezone`、`now`、`current_date`。

不额外汇入 system prompt。`agent_id` / `session_id` / 项目根 / 时区已经在 Session system block 里；`now` 这类每轮变化的动态值按仓库约定走 user message 的 `<info>` 块。system 前缀保持缓存友好。

### `sandbox`

| action | 说明 |
| --- | --- |
| `get` | 后端、实例、guest 工作目录、挂载点、是否持久 |
| `list_mounts` | 挂载进来的宿主目录及读写模式 |
| `explain_path` | 判定一个路径是否可达，并说明原因 |

`explain_path` 是这一期唯一动了策略层的改动。它只做词法判定，不读文件也不写文件，所以文件不存在不会改变结论。判定规则与文件工具共用 [`PathAccessRule`](../packages/city/src/workspace/file/PathAccessRule.ts)：边界改了，两边结论一起改，不会漂移。

两条边界语义需要说清：

- **相对路径**由路径规则按 Workspace 根目录解析，和文件工具一致。早先版本先把相对路径当沙箱路径处理，因为沙箱内 cwd 恰好是 `/workspace`，导致 `packages/city/src/index.ts` 被错误映射成重复两层的路径。
- **沙箱内绝对路径**（例如 `/workspace/README.md`）先映射回宿主路径再判定，`reason` 里会说明做过映射，避免 Agent 误以为 `/workspace` 就是宿主真实路径。

Workspace 没有 Shell 时（例如远程 Workspace）不报错，而是明确回答 `available: false`。

### `workspaces`

`list` / `get`，返回 `workspace_id`、`name`、`path`、`is_current`。数据来源是当前 City 已登记的 Workspace 资源，不读本地数据文件。

### `agent`

`list` / `get`，返回 `agent_id`、`name`、`model_id`、`is_current`。返回 City 下全部 Agent，不做 Workspace 过滤——协作认知边界是 City，不是 Workspace。

### `usage`

`get`，口径是 **user 级 token 用量**，属于 bureau 的能力。第一期 bureau 尚未暴露 user 级用量接口，因此统一返回 `unsupported_action`，不伪造数据。只返回 token，不做额度与费用换算：那需要计价规则和账本，塞进来会让 harness 多背一份随定价失效的口径。

## 模块结构

```
packages/city/src/city/tool/
  CityToolRuntime.ts       // 持有 namespace 声明、读配置、算可见性、产出 RuntimeTool
  CityToolDispatcher.ts    // 载荷校验、可见性判定、分发、结果信封
  CityToolVisibility.ts    // per-agent namespace 白名单
  CityToolArgs.ts          // 参数取值与校验
  CityToolErrors.ts        // 错误码
  namespaces/              // 一个 namespace 一个文件
    index.ts               // 注册顺序
    EnvNamespace.ts
    SandboxNamespace.ts
    WorkspacesNamespace.ts
    AgentNamespace.ts
    UsageNamespace.ts
packages/city/src/city/types/
  CityTool.ts              // 注册、分发、可见性、结果信封契约
  CityToolNamespaces.ts    // 各 namespace 的数据契约
```

中心只有五个文件。`city` 自己的输入 schema 放在工具定义旁边，namespace 数组由 Runtime 直接持有——给一个 Map 包一层 class 换不来什么。

时区与日期格式直接用 `@downcity/agent` 已导出的 `resolve_runtime_timezone` 与 `format_date_in_timezone`。日期用 sv-SE locale 输出 `YYYY-MM-DD`，harness 全域同一口径，工具内不再重复实现一份。

`CityToolDispatcher` 区分 `forbidden` 与 `not_found`：前者是 City 没有授予这个 namespace，后者是名字不存在。模型据此决定是换调用还是停止重试。provider 只实现自己的动作语义，成功返回数据，失败抛 `CityToolRuntimeError`，由 dispatcher 统一收敛成信封。

## 接入方式

`city` 是 City 内建能力，与 Plugin 工具走同一条注入路径：`City.get_session_tools()` 把 `city` 和 plugin 工具并进同一份工具集合，冲突立即失败。

没有做成官方 Plugin，是因为 Plugin 对模型只暴露 `plugin_call` / `plugin_read` 两个工具，Plugin 名不会变成工具名。做成 Plugin 的话模型看到的是 `plugin_call({ plugin: "city", ... })`，拿不到 `city(...)` 单入口和 namespace 分层。

## 可见性

默认规则：只读、非敏感的 namespace 对全部 Agent 可见。

可见性是 City 授予的，不能让 Agent 自己声明能看什么，因此配置放 City 级 `~/.downcity/plugins/city/config.toml`，与插件配置同层：

```toml
schema_version = 2

[config.defaults]
namespaces = ["env", "sandbox", "workspaces", "agent", "usage"]

[[config.agents]]
agent_id = "cheng_xu_yuan"
deny = ["usage"]
```

判定顺序固定：`deny` 优先，其次是 Agent 条目的 `allow`（整体替换默认集合），最后落到默认集合。敏感 namespace 不参与默认集合，必须显式 `allow`。配置在下一个 Session step 生效，不需要重启。

配置由用户手工编辑，读取失败不能让全部 Session 建不出来，因此异常时回退默认可见性。

**装配层责任划分。** `city` 这个 id 与 `plugins/city/config.toml` 的路径约定属于宿主装配，City 只认 `runtime.city_tool.read_config` 这个读取函数：

```ts
new City({ runtime: { city_tool: { read_config: () => data.plugins.get_config("city") } } })
```

早先版本复用了 `plugin_host.config("city")`，但那个钩子在 City 内部是插件专属的（有测试断言它只以真实插件名被调用），复用会让 City 自己挤进插件命名空间。现在四个宿主装配点各自提供 `runtime.city_tool`。

## 分期

**第一期（已实现）**：`city` 单入口与注册分发框架；`env.get`、`sandbox.get|list_mounts|explain_path`、`workspaces.list|get`、`agent.list|get`、`usage.get`；工具描述从注册表派生；City 级 per-agent 可见性；路径策略的纯判定接口。

**第二期（待定）**：写操作（`agent.delegate`、Session 间消息、task 管理）、写操作审批与审计落盘、敏感 namespace 的显式授权流程。

**不纳入**：文件读写与命令执行（会和现有工具形成两个真相源）、插件调用透传（会绕掉插件作用域模型）、凭据明文（任何情况下不通过此入口返回）。

## 契约中提前占位的字段

`capability`（`read` / `write`）与 `sensitivity`（`public` / `internal` / `sensitive`）在第一期用不到，但已经进入动作声明。写操作的审计、敏感项的可见性收敛都靠这两个字段驱动，后补会牵动每个 provider。

`WorkspaceSandboxSnapshot` 里的 `persistent` 与 `mounts[].mode` 同理：当前实现恒定 `persistent: true`、单条 `rw` 挂载，但远程 Workspace 与只读挂载补上时契约不用改。
