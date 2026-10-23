# MCP Power PRD

> 状态：架构已调整。当前采用下述统一入口方案；本文后续逐 Server 投影设计保留为历史设计，不再作为实施依据。
>
> 当前方案：MCP Power 管理配置和连接，Agent 使用固定的 `servers`、`tools`、`call` 动作。`tools` 返回原始工具名称及 JSON Schema，`call` 在 MCP 包内校验参数后调用 Server。Desktop 不再创建 Server Power，不再同步 projection snapshot，MCP 接入不需要 City SDK 专用适配。
>
> 当前审批规则：已启用 Server 的统一 `call` 无需审批。安装和卸载必须审批；Agent 安装、卸载管理动作尚未实现。
>
> 此处的 CLI 化指固定发现、帮助和调用方式；尚未增加可在 Shell 执行的 MCP 命令行程序。
>
> 范围：`packages/implementations/powers`、`packages/city`（最小契约扩展）、`private/apps/desktop`、`packages/cli`、`homepage`
>
> 目标：让 Downcity 作为 MCP client 接入外部 MCP server，并把每个 server 的工具直接投影为模型可调用的 Power
>
> 更新时间：2026-10-22
>
> 本版相对上一版（2026-09-21）的修订：去掉 `PowerProvisioner` 契约扩展，改为宿主装配投影 Power；连接作用域从 `(server, agent, workspace)` 改为按 `server_id` 共享；补上 `PowerAction.approval` 与 JSON Schema 校验这两个当前缺失的能力。修订依据见第 3、4、10 章。

## 1. 背景与问题

MCP（Model Context Protocol）已经成为外部工具接入的事实标准。Playwright、GitHub、Filesystem、各类数据库与 SaaS 都提供了 MCP server。Downcity 目前没有任何接入路径：仓库里 `mcp` 只出现在 WebMCP（网页内工具）与博客文章里，`packages/implementations/powers/src` 下不存在 `mcp` 目录。

Power 重构之后，Downcity 的工具面已经收敛为一个稳定模型：一个 Power 对应一个模型工具，工具名即 Power 名，动作是带点号 id 的具名能力，动作自带 input schema、`access` 元数据与审批入口。这套模型和 MCP 的 tool 概念几乎一一对应：

| MCP | Downcity Power |
| --- | --- |
| server | Power |
| tool | Action |
| `tools/list` 返回的 `inputSchema` | `PowerAction.input_schema` |
| `tools/call` 的 `arguments` | Action payload |
| tool annotations（`readOnlyHint` 等） | `PowerAction.access` |
| `isError: true` 结果 | `PowerActionResult.success = false` |
| `notifications/tools/list_changed` | Power 重新注册，触发工具面重编译 |

因此接入的难点不在协议适配，而在三件事：谁持有连接、工具如何命名、外部代码的信任边界放在哪里。

## 2. 目标与非目标

### 2.1 目标

1. Downcity 能作为 MCP client 连接 stdio 与 Streamable HTTP 两类 server。
2. 每个配置的 MCP server 投影为一个独立 Power，工具名即 server 配置的 ID，每个 MCP tool 映射为一个 action 并保留完整输入 schema。
3. MCP server 的工具描述、注解与返回值一律按不可信输入处理；副作用调用进入 Downcity 现有审批链路。
4. 单个 server 连接失败、启动失败或工具列表异常，不影响其他 server 与内建 Power。
5. 连接与子进程的生命周期闭合：配置变更、Power 移除与 City 关闭都能释放。
6. Desktop 与 CLI 共享同一份配置，两端都能管理 server；Desktop 提供完整界面，并保证密钥不回流到 Renderer。

### 2.2 非目标

- 不实现 Downcity 作为 MCP server 的反向能力。把内建 Power 暴露给 Claude Code、Cursor 等外部宿主是另一件事，单独设计。
- 不实现 MCP 的 Roots、Sampling、Logging。这三项在 2026-07-28 规范中已进入 Deprecated，新实现不应接入。
- 不实现 Elicitation 与 MRTR（Multi Round-Trip Requests）交互式往返。遇到 `resultType: "input_required"` 时返回明确失败，后续再评估。
- 不实现 resources 与 prompts 的模型侧投影。第一阶段只做 tools。
- 不实现旧 HTTP+SSE transport（2024-11-05），该传输已被规范标记为 Deprecated。
- 不引入 server 市场、自动安装或远程配置分发。MCP stdio server 会在宿主机执行任意代码，必须由用户显式配置。

## 3. 核心概念与所有权

一个 MCP 配置集合由两个层次的 Power 表达，职责分离：

| 层次 | Power | 职责 | 生命周期 |
| --- | --- | --- | --- |
| 管理面 | `mcp` | 持有全部连接、读写配置、给出投影所需的工具清单快照 | 随 City，与内建 Power 同级 |
| 投影面 | 每个 server 一个 | 只暴露该 server 的工具，转发到管理面持有的连接 | 由宿主装配，随配置与连接状态增删 |

`mcp` 是连接的唯一拥有者。子进程、HTTP 会话、重连状态、空闲计时器全部归它，投影 Power 不持有任何连接，只在 `execute` 里通过管理面提供的调用端口转发一次。这样做的直接收益是：连接不会因为投影 Power 被移除而泄漏，也不会因为配置改一个 server 就重建全部连接。

**投影 Power 由宿主装配，不由 `mcp` 自己注册。** 这是本版相对上一版的主要改动，理由是现有架构已经确立了这条分工：`LocalPowerLoader` 的模块注释明确写着「Power 实例不由 Loader 创建；同一个入口导出的实例直接交给 City」，Desktop 侧 `AgentController.provide_power()` 负责 `city.powers.add(registration)`，Power 的 `initialize` 从来没有注册其他 Power 的能力。上一版提议给 `PowerLifecycleContext` 增加 `provide_power` / `retract_power`，等于为单个连接器类型引入一份新的核心契约（投影所有权表、一层派生限制、释放顺序保证），而这条路径目前没有任何实现痕迹。改成宿主装配后，City 只需要补一个 `refresh` 语义，见 4.1。

这条分工需要一条数据通路：宿主必须知道「当前有哪些 server、每个 server 有哪些工具」才能构造投影 Power。因此 `mcp` 额外暴露一个投影快照动作（4.4），它是管理面到宿主的唯一出口。

## 4. 契约设计

### 4.1 核心契约扩展

本版只需要两处核心改动：`CityPowers.refresh`（本节）与 `PowerAction.approval`（4.2）。JSON Schema 校验（4.3）优先不动核心。

**为什么需要 `refresh`。** `CityPowers` 目前只有 `add` / `remove` / `snapshots` / `get` / `scope` / `register_http_routes` / `invoke` / `invoke_config` / `settled`。用它装配投影 Power 会卡在一处：

- `add` 在 `powers_by_id` 已有同一 `power_id` 且**不是同一实例**时抛 `Power already exists in City`（`CityPowerRuntime.add_power`）。
- `remove` 会把记录整个删掉，下一次 `add` 相当于全新注册。

而 MCP 的工具清单是会变的：server 升级、`tools/list_changed`、用户改 `disabled_tools`，都会让同一个 server 的工具集合变化。这时需要的是「原地替换同一个投影 Power」，而不是先删再建（先删会让工具面出现短暂空洞，也让并发调用失败）。

底层其实已经支持这个语义：`PowerRegistry.register` 遇到同名会先 `unregister` 再 `register_sync`。缺的只是 `CityPowerRuntime.add_power` 在它前面把这个语义挡住了。因此新增：

```ts
/** 在 City 对外 Power 集合中原地替换一个已登记 ID 的定义。 */
export interface CityPowers {
  /**
   * 替换同 ID Power 的定义，并重新发布工具面。
   *
   * 关键点（中文）
   * - ID 不存在时等价于 `add`；存在时只替换定义，不重建配置与存储作用域。
   * - 替换不触发旧实例的 `dispose`，因此只适用于不持有长期资源的 Power；
   *   MCP 投影 Power 符合这一前提（连接在管理面）。
   */
  refresh(input: CityPowerInput): Promise<void>;
}
```

持有长期资源的 Power 仍应走 `remove` → `add`，由生命周期链完成 `dispose` 与等待收口。两者的差别写进 `PowerDefinition` 的类型注释，避免调用方误用。

### 4.2 `PowerAction` 增加 `approval`

`PowerAction` 当前只有 `access?: "read" | "write"`，而 `access` 的注释写得很清楚：它是准确的元数据，**不**触发审批。真正请求审批的是 `CityAction` 基类（City 内建能力走的路径），它读 `context.interactions.approval`，并在缺少 `tool_call_id` 时拒绝执行。

MCP 工具是外部 server 动态声明的，让每个投影 action 自己在 `execute` 里判断要不要审批不可靠，也做不到统一。因此把审批提到 Action 契约：

```ts
export interface PowerAction<TInput, TResult> {
  /**
   * 是否在执行前请求用户审批。
   *
   * 关键点（中文）
   * - `access` 只描述读写代价，`approval` 决定是否真的停下来问。
   * - 由统一执行流水线处理，动作实现不自己读取审批模式，也不自己发起交互。
   */
  readonly approval?: boolean;
}
```

在 `execute_power_action` 里处理，顺序与 `CityAction.execute` 一致：先校验 payload，再审批，最后执行。两种失败要区分开：

| 情况 | 结果 |
| --- | --- |
| Session 入口，用户批准 | 继续执行 |
| Session 入口，用户拒绝 | `success: false`，说明未获批准 |
| 无 Session 入口（定时任务、HTTP、RPC） | `success: false`，说明无人在场无法授权 |
| 缺少 `tool_call_id` | `success: false`，说明本次调用没有可归属的工具调用身份 |

无 Session 入口已经在 `PowerCall` 里注入 `create_denied_interaction_port`，因此「无人在场」这条不需要额外分支，审批端口本身就是拒绝式的。

### 4.3 JSON Schema 校验

`execute_power_action` 的 `parse_action_payload` 目前只读 `input.action.input_schema?.zod`；`json_schema` 字段在整个执行路径里没有任何校验作用，只用于向模型展示。这对投影 action 不可接受：MCP 声明的是 JSON Schema 2020-12，若不接上校验，投影出来的 action 会接受任意入参。

有两条路径，实施时按实测结果选：

**路径 A（首选，零核心改动）** 用 SDK 提供的 JSON Schema → Standard Schema 桥接，把 server 的 `inputSchema` 包装后填入 `input_schema.zod`，现有流水线直接生效；同时把原始 JSON Schema 填进 `input_schema.json_schema` 供模型阅读。这条路径需要先确认 `@modelcontextprotocol/client` 侧可用的桥接导出（`@modelcontextprotocol/core` 暴露了 `fromJsonSchema` 与 `AjvJsonSchemaValidator`，但要确认客户端依赖树能直接引用）。

**路径 B（回退）** 给 `PowerActionExecution` 增加 `json_schema`-only 的校验分支：`zod` 缺失但 `json_schema` 存在时，用 JSON Schema 校验器校验。

无论走哪条，都要显式引入 JSON Schema 校验器依赖。**当前仓库没有直接依赖 ajv**：`pnpm-lock.yaml` 里只有 `ajv@6.15.0`，来自 webpack 的传递依赖。上一版 PRD 写的「ajv，SDK 已经依赖」不成立，v2 拆包后更不能假设。

错误信息必须保持 server 声明的字段路径，模型才能正确重试。校验通过后再发送，本地失败不产生网络往返；server 侧仍会校验一次，两层都保留。

### 4.4 管理面：`mcp`

```ts
/** MCP 连接与配置的唯一所有者。 */
export interface McpPowerDefinition extends PowerDefinition {
  /** 稳定名称，同时是模型工具名。 */
  readonly name: "mcp";
  /** 用户可见标题。 */
  readonly title: "MCP";
  /** 用途说明，首行进入模型侧工具描述。 */
  readonly description: string;
  /** 模型侧只暴露一个只读诊断动作。 */
  readonly actions: {
    /** 返回每个 server 的连接状态、工具数量与最近错误。 */
    readonly status: PowerAction;
  };
}
```

模型可见动作只有一个 `status`（`access: "read"`）。它的价值在于把静默失败变成可解释状态：server 连不上时模型看不到任何工具，`status` 能说明原因。server 的增删改查全部走配置动作，不进入模型面。

配置动作（用 `context.power.config_action()` 注册，供 Desktop 设置中心与 CLI 调用）：

| 动作 | 输入 | 返回 |
| --- | --- | --- |
| `config.read` | 无 | 脱敏后的 server 列表与运行状态 |
| `config.save` | 完整 server 列表草稿 | 保存后的脱敏视图 |
| `config.test` | `{ server_id }` | 真实连接一次并返回工具清单摘要 |
| `config.reload` | `{ server_id }` | 关闭现有连接并按当前配置重建 |

宿主动作（用 `context.power.action()` 注册，只供 Desktop main 与 CLI 进程调用，不暴露给模型，也不进 Config 面板）：

| 动作 | 输入 | 返回 |
| --- | --- | --- |
| `projection.snapshot` | 无 | 每个启用 server 的 ID、工具清单与信任级别 |

`projection.snapshot` 是宿主装配投影 Power 的输入。它会在需要时真实建连并完成一次 `tools/list`；连接失败时该 server 不出现在快照里，错误进入 `status`。这样「宿主拿到工具清单」与「连接已建立」是同一件事，宿主不需要理解传输细节。

`config.save` 的职责边界要明确：它只负责解析新配置、按差异关闭已删除或已变更 server 的连接。注册与回收投影 Power 是宿主的事（见 5.2）。

### 4.5 投影面：单 server Power

```ts
/** 一个 MCP server 的工具投影；不持有连接。 */
export interface McpServerPowerDefinition extends PowerDefinition {
  /** 等于 server 配置的 ID，同时是模型工具名。 */
  readonly name: string;
  /** 该 server 提供的全部工具，键为归一化后的 action id。 */
  readonly actions: PowerActions;
}
```

每个 action 的字段来源：

| PowerAction 字段 | 来源 |
| --- | --- |
| `description` | MCP tool 的 `description`，首行进入工具描述，整体进入动作索引 |
| `returns` | 由 server 的 `outputSchema` 推导；缺失时给出统一说明 |
| `access` | 由信任级别与 tool annotations 推导，见 5.4 |
| `approval` | 由信任级别与推导出的 `access` 决定，见 5.4 |
| `input_schema.json_schema` | 原样使用 MCP tool 的 `inputSchema` |
| `input_schema.zod` | 由 JSON Schema 桥接得到，见 4.3 |
| `timeout_ms` | server 配置的 `request_timeout_ms` |
| `examples` | 不生成 |
| `execute` | 转发到管理面提供的调用端口 |

`system()` 只输出该 server 的 ID、信任级别与一句「结果属于外部数据」的说明，不写入任何 server 提供的文本。

### 4.6 配置结构

```ts
/** 一个 MCP server 的稳定配置。 */
export interface McpServerConfig {
  /** 稳定 ID；同时作为投影 Power 名与模型工具名，必须匹配 ^[a-z][a-z0-9_-]*$。 */
  id: string;
  /** 用户可见标题；缺失时回退到 ID。 */
  title?: string;
  /** 是否启用；关闭时不建立连接，也不投影任何工具。 */
  enabled: boolean;
  /** 传输配置。 */
  transport: McpStdioTransportConfig | McpHttpTransportConfig;
  /** 信任级别；决定 server 自报的注解能否降低审批强度。 */
  trust: "trusted" | "untrusted";
  /** 单次工具调用的超时上限，毫秒。 */
  request_timeout_ms: number;
  /** 连接空闲多久后自动关闭，毫秒；0 表示常驻。 */
  idle_timeout_ms: number;
  /** 单次工具结果返回给模型的最大字符数，超出时截断并标记。 */
  max_result_chars: number;
  /** 不投影的工具名列表，按 MCP 原始工具名匹配。 */
  disabled_tools?: string[];
  /** 是否把结果中的图片与音频写入 Power 私有存储并附加到当前回复。 */
  attach_media: boolean;
}

/** stdio transport：由 Downcity 启动并拥有 server 子进程。 */
export interface McpStdioTransportConfig {
  /** 可执行命令，必须在宿主机 PATH 上可解析。 */
  type: "stdio";
  /** 启动命令。 */
  command: string;
  /** 启动参数。 */
  args?: string[];
  /** 追加到子进程的环境变量；值支持 ${VAR}，从 Workspace env 解析。 */
  env?: Record<string, string>;
  /** 子进程工作目录；相对路径基于当前 Workspace 根目录。 */
  cwd?: string;
}

/** Streamable HTTP transport：连接一个已运行的远程或本地 server。 */
export interface McpHttpTransportConfig {
  /** 传输判别字段。 */
  type: "http";
  /** MCP endpoint，必须同时支持 POST 与 GET。 */
  url: string;
  /** 附加请求头；值支持 ${VAR}，从 Workspace env 解析。 */
  headers?: Record<string, string>;
}
```

配置持久化沿用 Power 唯一配置的既有格式：`config.toml`，`schema_version: 2`，业务内容在 `config` 键下（`PowerRepository.get_config` / `set_config`）。因此 MCP 不需要自己的配置文件，`has_config: true` 即可接入 Desktop 设置中心。

密钥处理沿用 WebPower 的既有约定：`config.read` 不返回 `env` 与 `headers` 的值，只返回键名与「已配置」标记；清空必须是显式操作。同时支持 `${VAR}` 从 Workspace env 解析，让用户把 token 放在 Global / Env 而不是 Power 配置里。

## 5. 关键行为

### 5.1 连接生命周期与作用域

连接按需建立。首次需要某个 server 的工具清单（`projection.snapshot`）或首次调用它的工具时才连接，连接失败不影响其他 server，也不影响 City 启动。这与 WebPower 惰性创建浏览器 provider 的做法一致。

**连接作用域是 `server_id`，全局共享一份。** 上一版设计按 `(server_id, agent_id, workspace_id)` 建连，这一版改掉，原因有两条。一是投影 Power 在 City 里天然是单例：`CityPowerRuntime` 用 `powers_by_id` 管理，一个 ID 一个实例，工具面也是按 Power 名编译进 Agent 的（`Agent.resolve_tools` 从 `this.host.power_tools` 实时读取），连接状态没有地方按 agent/workspace 分开存放。二是收益方向相反：GitHub、Filesystem 这类 server 跨 agent 共享更省进程，而按三元组建连会让子进程数量随 Agent 与 Workspace 相乘增长。

代价是 stdio server 不再天然继承某个项目的工作目录。因此 `cwd` 与 `env` 由用户在 server 配置里显式声明，不从调用点推导。这一点要写进用户文档：需要项目上下文的 server，必须自己配 `cwd`。

释放路径有三条，都要闭合：

- `idle_timeout_ms` 到期，关闭空闲连接，下次需要时重新建立。
- 配置变更导致 server 被删除或传输参数变化，先关闭旧连接，再由宿主回收或替换投影 Power。
- `mcp` 的 `dispose` 关闭全部连接，包括正在重连的。

连接意外断开时按指数退避重连，上限有限次；期间调用返回明确失败而不是挂起。投影 Power 仍然存在，工具面不抖动。

### 5.2 宿主装配时序

宿主（Desktop 的 `AgentController`、CLI 的 City 启动路径）负责让投影 Power 与配置保持一致。同步函数只有一份，触发点有两个。

启动时：`mcp` 通过 `initialize_desktop_powers` 成为内建 Power；待它登记完成后，宿主调用一次同步。

配置变更后：Renderer 或 CLI 调用 `mcp.config.save` / `config.reload`，宿主在调用返回后同步。Desktop 侧落在 `AgentController.invoke_power_config` 上——它已经是 Config 动作的唯一入口，在这里判断 `power_id === "mcp"` 后触发同步，不需要新增事件通道。

同步逻辑是纯差异计算：

1. 读 `projection.snapshot`，得到期望集合（server_id → 工具清单）。
2. 与宿主当前已装配的投影 Power 集合比对。
3. 新增的走 `add`，工具清单变化的走 `refresh`，被删除或停用的走 `remove`。
4. 未出现在快照里的 server 视为连接失败，保留上一次的投影 Power 不做变动，避免一次网络抖动把工具面清空。

投影 Power 的注册项需要 `CityPowerRegistration` 的完整字段：`readme` 指向 `mcp` 自己的用户文档，`has_config` / `has_sidebar` / `has_mainview` 全为 `false`。它既不是内建注册也不是已安装 Power，因此不会出现在 Desktop 的 Power catalog 里（`PowerController.list` 只合并 builtin 与 installed），用户不会在设置界面看到一堆由 server 派生的条目。模型侧仍然能看到它，因为 Agent 的工具集来自 `city.power_tools`，与 catalog 是两条路径。

工具面变化在下一个 Step 生效。City 在 `add` / `refresh` / `remove` 后都会 `publish_surface_change`，`Agent.resolve_tools` 下一次求值即拿到新工具集，不需要重启，也不需要重启会话。

### 5.3 工具投影与命名

MCP 工具名允许 `-`、`.` 等字符，Power action id 使用点号路径。归一化规则：转小写，把 `[^a-z0-9_]` 替换为 `_`，压缩连续下划线，首字符为数字时前置 `_`。归一化后如果发生碰撞，按工具在 `tools/list` 返回顺序追加 `_2`、`_3`。映射关系保存在投影 Power 内，调用时还原为 MCP 原始工具名，保证往返无损。

`tools/list` 返回顺序在 2026-07-28 规范里被要求稳定，所以按顺序消歧是可复现的。

server ID 直接作为工具名，因此必须处理重名：

- server ID 必须匹配 `^[a-z][a-z0-9_-]*$`。这个正则与 `SessionPowerContent` 对 `power_id` 的校验一致，也与 Power 名「不能带点号」的现状一致。
- 不得与任何已注册 Power 同名。当前会撞上的保留名是：City 自有的 `context`、`ai`、`agent`、`session`、`shell`，以及官方内建的 `presentation`、`skill`、`task`、`messenger`、`memory`、`web`，加上管理面自己 `mcp`。
- `config.save` 阶段校验重名，冲突时拒绝保存并指出冲突对象，不留给运行期。
- City 的 `PowerRegistry` 本身已经拒绝重复 Power 名，即使漏过校验，也只有冲突的那个 server 注册失败，不会影响其他 server 或 Agent 的会话创建。

### 5.4 调用与结果映射

调用链路：投影 action → 管理面提供的调用端口 → `tools/call`。

审批与读写性质的推导规则：

| 信任级别 | `access` 推导 | `approval` |
| --- | --- | --- |
| `untrusted`（默认） | 全部工具为 `write` | `true`，全部调用请求审批 |
| `trusted` | `readOnlyHint: true` 为 `read`，其余为 `write` | 等于「`access === "write"`」，即写类工具请求审批、只读工具直接执行 |

MCP 规范明确要求：除非 server 可信，否则 tool annotations 必须按不可信处理。因此 `access` 只由本地配置与信任级别推导，server 无法通过注解把写操作声明成读操作来绕过审批。

结果映射规则：

| MCP 结果 | PowerActionResult |
| --- | --- |
| `content[].type === "text"` | 汇总进 `message`；存在 `structuredContent` 时进 `data` |
| `structuredContent` | 原样进 `data` |
| `content[].type === "image"` | `attach_media` 为真时写入 `storage`，作为 `messages[].parts[].type = "file"` 附加到当前回复 |
| `content[].type === "audio"` | 同图片；第一阶段仅在 `attach_media` 为真时保存，不保证模型可用 |
| `content[].type === "resource_link"` / `"resource"` | 序列化为 JSON 进 `data`，不自动抓取 |
| `isError: true` | `success: false`，文本进 `error` |
| `resultType: "input_required"` | `success: false`，说明当前不支持交互式往返 |

结果总长度超过 `max_result_chars` 时截断，并在 `data` 中显式给出 `truncated: true` 与原始长度。截断必须显式，让模型知道自己看到的不完整。

取消与超时沿用统一执行流水线：`execute` 把 `context.call.abort_signal` 传给 MCP 请求，`timeout_ms` 由流水线触发的 abort 实现，不需要在 action 内自己计时。

### 5.5 注入边界

三条硬约束：

1. server 提供的 `name`、`title`、`description`、`inputSchema` 只作为模型侧工具元数据，不进入 `system()`，也不拼进任何 Agent 指令。
2. 工具返回值一律作为外部数据呈现，不解释为指令。文本内容进入 `message` 与 `data`，不写入 `messages[].role = "user"`。
3. `access` 与 `approval` 只由本地配置与信任级别推导，server 无法通过注解影响二者。

### 5.6 失败隔离

单个 server 的任何失败都限定在自身范围内：连接失败、握手失败、工具列表异常、单次调用失败都只影响该 server 的投影。`mcp` 的 `status` 动作汇总每个 server 的 `state`、`tool_count`、`last_error` 与 `updated_at`，供模型与 UI 查询。`mcp` 自身不因为某个 server 异常而进入错误状态。

Desktop 侧还有一层：`initialize_desktop_powers` 用 `Promise.allSettled` 并行初始化并逐个记录失败，`mcp` 初始化失败只影响它自己。

## 6. Desktop 体验

新增 `mcp` 的配置界面，参照 Web Power Renderer 的组织方式（`web/renderer/WebPowerRenderer.tsx`、`WebGeneralView.tsx` 与 `web/renderer/WebPowerShared.ts`）：视图只组合 `ui.components`，不写样式类名，数据通过 `power.invoke` 读写。UI 能力只有 config：`has_config: true`，`has_sidebar: false`，`has_mainview: false`。`PowerRendererHost` 的校验允许「只有 config」这一形态（仅当 sidebar / config / message 全缺时才报错），静态清单与实际导出必须一致。

- server 列表：标题、传输类型、启用开关、连接状态、工具数量、最近错误。
- 新增与编辑：ID、传输表单（stdio 的 command / args / env / cwd，HTTP 的 url / headers）、信任级别、超时与结果上限、工具过滤。
- 连接测试：保存后真实连接一次，展示工具数量与前若干工具名；失败时展示原始错误。
- 手动重载：关闭并重建单个 server 的连接与工具投影。
- 密钥输入框沿用「已配置 / 清空」交互，保存后不回显。

界面需要一句直白的安全提示：stdio server 会在本机执行任意代码，只配置可信来源；HTTP server 由外部服务返回的工具描述与结果同样按不可信处理。

CLI 侧复用同一份 `config.toml`，通过已有的 `downcity power` 命令树（`packages/cli/src/city/command/PowerCommand.ts`）暴露 `mcp` 的 config 动作，不新增命令组。两端不并行维护配置格式。

## 7. 模块划分

```
packages/implementations/powers/src/mcp.ts                              # @downcity/powers/mcp 子路径入口
packages/implementations/powers/src/mcp/Power.ts                        # McpPower：连接所有权、配置差异
packages/implementations/powers/src/mcp/ServerPower.ts                  # 单 server 投影 Power 定义
packages/implementations/powers/src/mcp/ProjectionSync.ts               # 期望集合与已装配投影的差异计算
packages/implementations/powers/src/mcp/PROMPT.ts                      # 注入模型的最小说明文本
packages/implementations/powers/src/mcp/runtime/Connection.ts           # 单连接：连接、列工具、调用、关闭、重连
packages/implementations/powers/src/mcp/runtime/ConnectionRegistry.ts   # 按 server_id 与空闲超时管理连接
packages/implementations/powers/src/mcp/runtime/Transport.ts           # stdio 与 Streamable HTTP 传输构造
packages/implementations/powers/src/mcp/runtime/ToolProjection.ts       # MCP tool 到 PowerAction 的映射与命名归一化
packages/implementations/powers/src/mcp/runtime/ResultMapping.ts        # MCP 结果到 PowerActionResult 与 messages
packages/implementations/powers/src/mcp/runtime/Validation.ts           # 配置校验、保留名检查、JSON Schema 接入
packages/implementations/powers/src/mcp/host/McpPowerConfigActions.ts   # config.read / save / test / reload
packages/implementations/powers/src/mcp/host/McpProjectionActions.ts    # projection.snapshot
packages/implementations/powers/src/mcp/renderer/McpPowerConfig.tsx     # Desktop 配置界面
packages/implementations/powers/src/mcp/types/McpPower.ts               # 配置与运行状态类型
packages/implementations/powers/src/mcp/types/McpSettings.ts            # 配置草稿、脱敏视图与测试结果类型
packages/implementations/powers/src/mcp/types/McpProjection.ts          # 投影快照与工具清单类型
```

每个模块保持 800 行以内，类型统一放在 `types/` 下，全部文件写模块级中文文档注释。

配套改动：

- `packages/city/src/city/types/CityPower.ts` 与 `packages/city/src/city/power/CityPowerRuntime.ts`：新增 `CityPowers.refresh`。
- `packages/city/src/power/types/PowerRuntime.ts`：`PowerAction` 新增 `approval`。
- `packages/city/src/power/core/PowerActionExecution.ts`：审批与 JSON Schema 校验接入统一流水线。
- `packages/implementations/powers/src/builtin/BuiltinPowerTypes.ts`：增加 `mcp` 注册项（`has_config: true`，无 Sidebar 与 Mainview）。
- `packages/implementations/powers/src/renderers.ts`：增加 `mcp` 渲染器。
- `packages/implementations/powers/package.json`：增加 `./mcp` 导出与 `@modelcontextprotocol/client` 依赖。
- `packages/implementations/powers/readmes/mcp.readme.md` 用户文档。
- Desktop：`AgentController.invoke_power_config` 触发投影同步；`create_desktop_builtin_power_registrations` 已由 `LocalPowerLoader` 统一装配，无需另加路径。
- CLI：`downcity power` 命令树（`packages/cli/src/city/command/PowerCommand.ts`）暴露 `mcp` 的 config 动作，不新增命令组。CLI 借宿主的同一套投影同步逻辑，实现位置与 Desktop 对齐。
- homepage：用户可见文档。当前站点结构是 `content/docs/{en,zh}/power/*.mdx`（无 `plugin/` 目录），新增 `power/mcp.mdx` 并更新同目录 `meta.json`。

## 8. 分阶段实施

**第一阶段**

stdio 与 Streamable HTTP 连接、工具投影、调用与文本 / `structuredContent` 结果映射、信任与审批、失败隔离、`status` 动作、配置动作、投影快照与宿主装配、Desktop 界面、CLI 命令、用户文档。

第一阶段内部建议按依赖顺序推进：先落 `CityPowers.refresh` 与 `PowerAction.approval` 两个核心改动并各自 typecheck；再实现 `mcp` 的管理面与 runtime；最后接 Desktop 与 CLI。核心改动先跑通，投影层才有可依赖的语义。

**第二阶段**

图片与音频内容附加到回复、`tools/list_changed` 触发的工具面重建、resources 与 prompts 的只读动作、HTTP server 的 OAuth 授权、`input_required` 往返支持。

**暂不排期**

Downcity 作为 MCP server。

## 9. 验收标准

1. 配置一个 stdio server 与一个 HTTP server，两者工具在下一个 Step 同时出现在模型工具清单中，工具名等于 server ID。
2. 关闭其中一个 server 后，其工具消失，另一个 server 与内建 Power 不受影响，且不产生重复工具名冲突。
3. 未信任 server 的全部调用都进入审批；审批拒绝时不执行调用；信任 server 的只读工具不触发审批。
4. 定时任务入口调用未信任 server 的写类工具时返回明确失败，不挂起、不放行。
5. server 返回 `isError: true` 时模型收到 `success: false` 与可读错误；超长结果被截断并标记 `truncated`。
6. 入参不符合 server 声明的 `inputSchema` 时本地即拒绝，不产生网络往返，错误信息带 server 声明的字段路径。
7. 改变单个 server 的工具集合（改 `disabled_tools` 或 server 升级）后，工具面原地替换，不出现「先消失再出现」的中间态。
8. 删除 server 配置后连接被关闭、子进程退出、投影 Power 被回收；City 关闭后无残留进程。
9. 移除 `mcp` 或停用某个 server 后，对应投影 Power 被回收；`mcp` 自身被移除时不留下任何指向已关连接的投影。
10. `config.read` 不返回 `env` 与 `headers` 的任何值。
11. 单个 server 连接失败时 City 启动、其他 server 与 Agent 会话创建均正常；且该 server 的旧投影 Power 不被清空。
12. 模块行数、类型注释与命名符合仓库工程规范，`pnpm typecheck` 通过。

## 10. 风险与待确认

**JSON Schema 校验的落地方式。** 4.3 的两条路径需要实施时实测：路径 A 依赖 SDK 暴露的桥接导出能否从客户端依赖树直接引用。若不可用则走路径 B，代价是给 `PowerActionExecution` 加一个校验分支。这是第一阶段必须先确认的一项，它决定投影 action 的入参是否真的被校验。

**`refresh` 与 `dispose` 的边界。** `refresh` 不触发旧实例 `dispose`，这对不持有资源的投影 Power 是对的，但把「哪些 Power 可以 refresh」的判断交给了调用方。需要在 `PowerDefinition` 或 `CityPowers.refresh` 的注释里写清前提，避免将来有 Power 用它绕过资源释放。

**`approval` 是 `@downcity/city` 的对外契约变化。** 它会让 `PowerAction` 的消费者（含第三方 Power）看到新字段。虽然可选、默认关闭，不构成兼容问题，但属于用户可见能力变化，提交前要走 `city:patch:build`。

**SDK 版本。** v2（`@modelcontextprotocol/client`）已 GA 到 2.3.1，实现 2026-07-28 无状态规范；v1（`@modelcontextprotocol/sdk`）停在 1.32.1。v2 取消了 `initialize` 握手与 `Mcp-Session-Id`，每个请求自带协议版本与客户端能力，连接管理因此简化——这正好是本设计里最棘手的一块。它要求 Standard Schema（Zod v4 可直传），powers 已是 `zod@^4.4.3`，兼容。**但仍需用一组真实 server（官方 Playwright、Filesystem、GitHub）验证互操作**：如果对仍在 v1 的旧 server 兼容不足，需要重新评估锁 v1 还是做双版本探测。这个选择会影响 5.1 的生命周期描述。

**工具数量。** 单个 MCP server 可能暴露几十个工具，全部进工具描述会推高每个 Step 的上下文成本。第一阶段靠 `disabled_tools` 手动裁剪；如果实际使用中出现明显的上下文压力，再考虑按需投影或分组。

## 11. 文档与版本

按仓库约定，`@downcity/powers` 与 `@downcity/city` 都发生对外能力变化，提交前用 `pnpm patch:build -- --powers --city` 完成版本自增与构建（根目录对应脚本为 `powers:patch:build` / `city:patch:build`）。用户可见文档写入 `readmes/mcp.readme.md` 与 homepage 的 `content/docs/{en,zh}/power/mcp.mdx`，开发设计文档留在 `public/docs/`。
