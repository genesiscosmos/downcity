# City Power 设计：Agent 的运行时事实与协作入口

Agent 能读项目文件、能执行命令、能通过 Power 访问外部系统，但有一类事实它只能靠猜：**我现在跑在哪个 Agent、哪个 Session、哪个 Workspace 下，沙箱里挂了什么，隔壁还有哪些 Agent**。这些事实只存在于 City 内部。

猜错的代价是具体的。沙箱只挂载 Workspace 目录，Agent 去读 Workspace 外的路径时，文件工具只回一句 `sandbox_denied`：它不知道是路径不存在、是只读，还是在挂载点之外，于是换个写法再试，几轮下来上下文烧掉了但问题没解决。

City 自有的三个 power 就是这块空白的出口。它们不替代任何现有工具，只补齐「运行时自我认知」与「City 自己拥有的生成能力」。

## 判断标准

一个能力该不该进 City 自有 power，只看一条：**这件事是不是只有 harness 自己知道。**

| 能力 | 归属 | 为什么不进 City power |
| --- | --- | --- |
| 读写项目文件 | 文件工具 | 有 Workspace 路径策略，是独立关注点 |
| 执行命令 | `shell` power | 另有执行后端选择与审批 |
| 收发消息、附件 | `messenger` power | 连接外部系统，账号级配置 |
| 定时任务 | `task` power | 有独立的生命周期存储 |
| 凭据 | Power Config / Global Env | 归属在配置层，且敏感 |

## 三个 power

`context` 只读；`agent.create` 创建持久主体，`ai` 会消耗额度或写文件。各自动作声明 `access` 与 `approval`。

只读事实与会写能力用同一套契约，这是这个设计的核心取舍：区分不在机制上，而在每个动作声明的 `access`。因此模型看同一份索引就能知道哪些调用有代价，而不需要学两套调用方式。

| 工具名 | 动作数 | 动作 id |
| --- | --- | --- |
| `context` | 7 | `env.get`、`sandbox.get`、`sandbox.list_mounts`、`sandbox.explain_path`、`workspaces.list`、`workspaces.get`、`usage.get` |
| `ai` | 6 | `image.models`、`image.create`、`image.result`、`sound.models`、`sound.asr`、`sound.tts` |
| `agent` | 2 | `agent.list`、`agent.create` |

**动作 id 是 `组名.动作名`，与所属 power 名无关。** `env.get` 属于 `context`，不是某个叫 `env` 的 power；`image.*` 与 `sound.*` 同属 `ai`。这样领域划分变化时，模型侧动作 id 保持稳定。

省略 `action` 的调用不报错，而是返回该 power 的动作索引，省掉一轮试错：

| 调用 | 返回 |
| --- | --- |
| `context({})` | `context` 的全部动作、参数、返回结构与读写性质 |
| `context({ action: "sandbox.explain_path", args: { path: "~/.downcity" } })` | 执行结果 |

工具描述从动作自描述派生，动作增减时模型侧描述自动跟上，不会与实现漂移。

## 动作组

组是 power 内部的领域前缀，也是私有文件的分区键。一个组是一类能力，例如 `env`、`sandbox`、`image`。

```
context: env, sandbox, workspaces, usage
ai:      image, sound
agent:   agent
```

组只负责两件事：给动作加领域前缀、提供一段 `system()` 说明文本。它不参与分发，也不感知结果信封。新增一个组就是新增一个子类文件，并在所属领域 power 的动作组列表里登记一次。

### `context`

Agent 对自身与执行边界的认知。

`env.get` 返回 `agent_id`、`agent_name`、`session_id`、`turn_id`、`workspace_id`、`workspace_name`、`workspace_path`、`model_id`、`timezone`、`now`、`current_date`。

不额外汇入 system prompt。`agent_id` / `session_id` / 项目根 / 时区已经在 Session system block 里；`now` 这类每轮变化的动态值按仓库约定走 user message 的 `<info>` 块。system 前缀保持缓存友好。

`sandbox` 回答「我在什么隔离环境里跑」「哪些宿主目录被显式授权」「这个路径为什么被拦」：

| action | 说明 |
| --- | --- |
| `get` | 后端、实例、guest 工作目录、挂载点、是否持久 |
| `list_mounts` | 挂载进来的宿主目录及读写模式 |
| `explain_path` | 判定一个路径是否可达，并说明原因 |

`explain_path` 只做词法判定，不读文件也不写文件，所以文件不存在不会改变结论。判定规则与文件工具共用 [`PathAccessRule`](../packages/city/src/workspace/file/PathAccessRule.ts)：边界改了，两边结论一起改，不会漂移。

两条边界语义需要说清：

- **相对路径**由路径规则按 Workspace 根目录解析，和文件工具一致。
- **沙箱内绝对路径**（例如 `/workspace/README.md`）先映射回宿主路径再判定，`reason` 里会说明做过映射，避免 Agent 误以为 `/workspace` 就是宿主真实路径。

Workspace 没有 Shell 时（例如远程 Workspace）不报错，而是明确回答 `available: false`。

`workspaces.list|get` 返回 `workspace_id`、`name`、`path`、`is_current`。数据来源是当前 City 已登记的 Workspace 资源，不读本地数据文件。

`usage.get` 的口径是 **user 级 token 用量**，属于 bureau 的能力。目前 bureau 尚未暴露 user 级用量接口，因此统一返回 `unsupported_action`，不伪造数据。只返回 token，不做额度与费用换算：那需要计价规则和账本，塞进来会让 harness 多背一份随定价失效的口径。

### `ai`

City 自己拥有的生成能力，来自 City 持有的 Embassy。

`image.models|create|result`：本地图片读取以当前 Workspace 为根，并在进入图片服务前转成 data URL。

`result` 把远端图片落到动作组私有目录，**只返回本地绝对路径**，不注入 Agent 消息。这样所有 power 共享同一个返回值契约，不需要为它引入第二条消息通道；模型在回复里用 `![](path)` 引用即可。未能本地化的图片保留远端 URL，并通过 `warning` 说明，不静默丢弃。

`sound.models|asr|tts`：`tts` 同 `image.result` 一样只返回已落盘的本地音频路径。`asr` 同时服务模型调用与其它 power 的程序化调用（例如 messenger 入站音频自动转写），因此不再需要单独的非模型侧动作。

### `agent`

`agent.list` 返回 `agent_id`、`name`、`description`、`model_id`、`is_current`，包含 City 下全部 Agent，不做 Workspace 过滤。简介足以支持协作对象选择，不再提供独立 `get`。

`agent.create` 接收 `name`、`description`、`instruction`、`model_id`，经用户审批后调用宿主的 `runtime.create_agent`。宿主负责生成稳定 ID、持久化配置、装配模型、加入当前 City 以及失败回滚。Power 不直接操作本地产品数据库。

跨 Agent 工作使用独立的 `session` Tool：`start` 选择 `agent_id` 与项目并返回轻量 Session 对象；`send` 在同一个工作会话中追加输入；`check`、`reply`、`stop` 同样接受目标 `agent_id`。省略时操作当前 Agent。工作会话和委派记录始终归目标 Agent，调用方身份同时保存 `agent_id` 与 `session_id`，结果回传到真实发起会话。`agent.send`、`ask`、`delegate` 不进入本 Power。

## 模块结构

三个领域 power、一层共享基类，加七个动作组。

```
packages/city/src/city/power/builtin/
  CityGroupPower.ts        // 基类：动作组 → 扁平动作 id 的展开 + system 合并
  ContextPower.ts          // context：env / sandbox / workspaces / usage
  AiPower.ts               // ai：image / sound
  AgentPower.ts            // agent：agent
  shell/ShellPower.ts      // shell，与三个领域 power 同构
  CityAction.ts            // 抽象动作：自己声明自己、自己执行自己
  CityActionGroup.ts       // 抽象动作组：组名、动作列表、可选 system 说明
  groups/
    EnvGroup.ts  SandboxGroup.ts  WorkspacesGroup.ts  UsageGroup.ts  AgentGroup.ts
    image/                 // ImageGroup + 运行辅助 + 领域类型
    sound/                 // SoundGroup + 运行辅助 + 领域类型
packages/city/src/city/types/
  CityPowerContext.ts      // 动作执行上下文与错误契约
  CityPowerData.ts         // 只读动作的数据契约
```

一个动作是一个类：

```ts
class ExplainPathAction extends CityAction<z.infer<typeof explain_path_input>> {
  readonly action = "explain_path"
  readonly description = "Decide whether a path is reachable for the given intent and why it is blocked."
  readonly returns = "allowed, resolved_path, intent, matched_mount, reason_code, reason"
  readonly args_schema = explain_path_input

  protected async run(args, context) {
    ...
  }
}
```

声明（`action` / `description` / `returns` / `access` / `args_schema`）既驱动模型侧索引，也驱动运行时参数校验，因此不存在「声明一处、校验另一处」的漂移。动作不写 switch：基类按名取到动作对象后直接调用。

校验入口在基类的模板方法上，不在 `run` 里：`execute()` 先拒绝未声明的参数，再调 protected 的 `run()`。因此没有哪个动作能漏掉这层校验。

时区与日期格式直接用 `@downcity/type` 已导出的 `resolve_runtime_timezone` 与 `format_date_in_timezone`。日期用 sv-SE locale 输出 `YYYY-MM-DD`，harness 全域同一口径，动作内不再重复实现一份。

失败只分两类：`invalid_args`（载荷或参数不合法）与 `not_found`（动作名不存在），另有 `usage` 的 `unsupported_action`。动作对象只实现自己的语义，成功返回数据，失败抛 `CityActionError`，由 power 运行时统一收敛成信封。

会写的能力（`image`、`sound`）只返回数据，不注入 Agent 消息：`image.result` 返回已落盘的本地路径，`sound.tts` 同理。

## 私有文件分区

`files_for(agent_id, group_id)` 的作用域是 `agents/<agent_id>/powers/<group_id>/`，键是**组名**而不是 power 名。

这样组在 power 之间搬迁不会改变落盘路径：`image.result` 生成的图片路径在领域拆分前后完全一致，已有本地文件不会失效。

## 接入方式

三个 power 都是 City 内建能力，与其它 power 走同一条注册路径：`City.get_session_tools()` 把三个 power 与 plugin 工具并进同一份工具集合，冲突立即失败。

没有做成官方 Power package，是因为它们的依赖是 City 内部事实源（Agent / Workspace 快照）与 Embassy，这些能力不应暴露给外部 power。

## 可用性

与其它 Power 同一口径：**City 注册了什么，每个 Agent 就能用什么**，没有 per-agent 门控，也没有配置文件。

这里曾出现三层投机性设计，已全部删除：

1. City 级 `powers/city/config.toml` + 四个宿主装配点的 `read_config` 接线 + per-agent `allow` / `deny` 判定。
2. 动作上的 `sensitivity` 字段与 `is_sensitive()`，以及 `tools()` 里那条永远通过的过滤。
3. dispatcher 里永远不可达的 `forbidden` 分支。

三者的共同问题是它们只读不写：计算的是「全部」这个常量。仓库里其他能力（Power、Workspace Tools）都没有 per-agent 这个维度。将来真需要限权时，加上去的成本并没有变高——那是 `tools()` 里一行过滤加一个错误分支。

## 分期

**已实现**：`context`、`ai`、`agent` 三个领域 power 与动作组框架；`env.get`、`sandbox.get|list_mounts|explain_path`、`workspaces.list|get`、`usage.get`；`agent.list|get`；`image.models|create|result`、`sound.models|asr|tts`；工具描述与索引由对象自描述派生；路径策略的纯判定接口。

**待定**：`agent` 的写操作（`agent.delegate`、Session 间消息）与其审批、审计落盘。

**不纳入**：文件读写与命令执行（会和现有工具形成两个真相源）、插件调用透传（会绕掉插件作用域模型）、凭据明文（任何情况下不通过此入口返回）。

## 动作声明中的 `access`

`access`（`read` / `write`）进入模型侧索引，告诉模型当前动作是否有代价。只读事实查询全部为 `read`；`ai` 的动作声明为 `write`，因为它们消耗额度、调用付费模型或写文件。`CityAction` 另有 `approval` 开关，声明后由基类在执行前通过 `interactions.approval` 请求调用方确认，`image.create|result` 与 `sound.asr|tts` 已开启。

`WorkspaceSandboxSnapshot` 里的 `persistent` 与 `mounts[].mode` 是同类事实：当前实现恒定 `persistent: true`、单条 `rw` 挂载，但远程 Workspace 与只读挂载补上时契约不用改。
