# MCP Power PRD

> 状态：待评审
>
> 范围：`packages/implementations/powers`、`packages/city`（最小契约扩展）、`app/desktop`、`homepage`
>
> 目标：让 Downcity 作为 MCP client 接入外部 MCP server，并把每个 server 的工具直接投影为模型可调用的 Power
>
> 更新时间：2026-09-21

## 1. 背景与问题

MCP（Model Context Protocol）已经成为外部工具接入的事实标准。Playwright、GitHub、Filesystem、各类数据库与 SaaS 都提供了 MCP server。Downcity 目前没有任何接入路径：仓库里 `mcp` 只出现在 WebMCP（网页内工具）与博客文章里，不存在 client 实现。

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
6. Desktop 提供完整的 server 管理界面，并保证密钥不回流到 Renderer。

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
| 管理面 | `mcp` | 持有全部 MCP 连接，读写配置，注册与回收投影 | 随 City，与内建 Power 同级 |
| 投影面 | 每个 server 一个 | 只暴露该 server 的工具，转发到管理面持有的连接 | 随配置与连接状态动态增删 |

`mcp` 是连接的唯一拥有者。子进程、HTTP 会话、重连状态、空闲计时器全部归它，投影 Power 不持有任何连接，只在 `execute` 里向管理面要一次调用。这样做的直接收益是：连接不会因为投影 Power 被移除而泄漏，也不会因为配置改一个 server 就重建全部连接。

投影 Power 是 `mcp` 的派生资源，生命周期必须跟随所有者。City 需要知道「这个 Power 是谁注册的」，才能在 `mcp` 被移除时一起回收，避免留下指向已关闭连接的空壳工具。

## 4. 契约设计

### 4.1 需要的最小核心扩展

`PowerLifecycleContext` 目前提供 `power`、`config`、`storage`、`logger`、`notifications`、`system`，没有注册其他 Power 的能力。新增一个受限端口：

```ts
/** Power 在 City 生命周期中对其他 Power 的受限注册能力。 */
export interface PowerProvisioner {
  /** 注册一个由当前 Power 拥有、并随其配置变化的投影 Power。 */
  provide_power(power: PowerDefinition): Promise<void>;
  /** 移除一个此前由当前 Power 注册的投影 Power。 */
  retract_power(power_name: string): Promise<void>;
}
```

`PowerLifecycleContext` 增加 `readonly powers: PowerProvisioner`。City 侧同步维护 `projection_owner: Map<projection_name, owner_name>`，并遵守三条规则：

1. `provide_power` 只在当前 Power 的 `initialize` 或配置变更回调中调用，注册的 Power 名不得与任何既有 Power 重名，也不得与所有者同名。
2. 所有者被移除时，City 先回收其全部投影，再释放所有者本身；City 关闭时沿用同一顺序，不依赖 `dispose` 里的二次调用。
3. 投影 Power 不能再 `provide_power`，限制为一层，避免循环与不可预测的释放顺序。

`mcp` 的 `dispose` 只关闭连接，不回收投影，因为 City 的释放顺序已经覆盖这件事。这样 `dispose` 不需要处理「运行时仍在活动、关闭时已被封闭」这两种不同状态。

**为什么不做成构造注入。** 另一种实现是让宿主把 `add` / `remove` 回调注入 `McpPower` 构造函数，完全不动 `@downcity/city`。这需要每个宿主记得注入，漏掉时投影能力静默缺失；而且 City 无法保证投影随所有者回收。既然「一个 Power 派生并拥有其他 Power」是连接器类 Power 的通用关系，把它放进 Power 生命周期契约、由 City 统一保证释放顺序，是更小的心智负担。

### 4.2 管理面：`mcp`

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

配置动作（`config_*`，供 Desktop 与 CLI 调用）：

| 动作 | 输入 | 返回 |
| --- | --- | --- |
| `config.read` | 无 | 脱敏后的 server 列表与运行状态 |
| `config.save` | 完整 server 列表草稿 | 保存后的脱敏视图 |
| `config.test` | `{ server_id }` | 真实连接一次并返回工具清单摘要 |
| `config.reload` | `{ server_id }` | 关闭现有连接并按当前配置重建 |

`config.save` 成功后必须完成三件事：解析新配置、按差异注册或回收投影 Power、关闭已删除或已变更 server 的连接。差异比对以 server ID 为键，只有传输配置、信任级别或工具过滤发生变化的 server 才重建连接。

### 4.3 投影面：单 server Power

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
| `input_schema.json_schema` | 原样使用 MCP tool 的 `inputSchema` |
| `input_schema.zod` | 不提供，改用 JSON Schema 校验，见 5.3 |
| `timeout_ms` | server 配置的 `request_timeout_ms` |
| `examples` | 不生成 |
| `execute` | 转发到管理面持有的连接 |

`system()` 只输出该 server 的 ID、信任级别与一句「结果属于外部数据」的说明，不写入任何 server 提供的文本。

### 4.4 配置结构

```ts
/** 一个 MCP server 的稳定配置。 */
export interface McpServerConfig {
  /** 稳定 ID；同时作为投影 Power 名与模型工具名，必须匹配 ^[a-z][a-z0-9_]*$。 */
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

密钥处理沿用 WebPower 的既有约定：`config.read` 不返回 `env` 与 `headers` 的值，只返回键名与「已配置」标记；清空必须是显式操作。同时支持 `${VAR}` 从 Workspace env 解析，让用户把 token 放在 Global / Env 而不是 Power 配置里。

## 5. 关键行为

### 5.1 连接生命周期与作用域

连接按需建立。首次调用某个 server 的工具时才连接，连接失败不影响其他 server，也不影响 City 启动。这一点与 WebPower 惰性创建浏览器 provider 的做法一致。

连接作用域以 `(server_id, agent_id, workspace_id)` 为键，与 WebPower 的 provider 作用域保持一致。stdio server 继承 Workspace 的 `cwd` 与环境，跨 Workspace 共享会把一个项目的上下文带进另一个项目；server 内部也可能持有会话状态，跨 Agent 共享会造成相互干扰。代价是进程数量随 Agent 与 Workspace 增加，第一阶段接受这个代价，后续如需优化再单独设计共享策略。

释放路径有三条，都要闭合：

- `idle_timeout_ms` 到期，关闭空闲连接，下次调用重新建立。
- 配置变更导致 server 被删除或传输参数变化，先关闭旧连接再按新配置重建。
- `mcp` 的 `dispose` 关闭全部连接，包括正在重连的。

连接意外断开时按指数退避重连，上限有限次；期间调用返回明确失败而不是挂起。投影 Power 仍然存在，工具面不抖动。

### 5.2 工具投影与命名

MCP 工具名允许 `-`、`.` 等字符，Power action id 使用点号路径。归一化规则：转小写，把 `[^a-z0-9_]` 替换为 `_`，压缩连续下划线，首字符为数字时前置 `_`。归一化后如果发生碰撞，按工具在 `tools/list` 返回顺序追加 `_2`、`_3`。映射关系保存在投影 Power 内，调用时还原为 MCP 原始工具名，保证往返无损。

`tools/list` 返回顺序在 2026-07-28 规范里被要求稳定，所以按顺序消歧是可复现的。

server ID 直接作为工具名，因此必须处理重名：

- server ID 必须匹配 `^[a-z][a-z0-9_]*$`，且不得等于 `city`、`shell`、`skill`、`task`、`chat`、`memory`、`web`、`mcp`。
- `config.save` 阶段校验重名，冲突时拒绝保存并指出冲突对象，不留给运行期。
- City 本身已经拒绝重复 Power 名，即使漏过校验，也只有冲突的那个 server 注册失败，不会影响其他 server 或 Agent 的会话创建。

### 5.3 调用与结果映射

调用链路：投影 action → 管理面连接 → `tools/call`。

入参校验使用 JSON Schema 校验器（ajv，SDK 已经依赖），不做 JSON Schema 到 Zod 的转换。理由有两点：MCP 声明的是 JSON Schema 2020-12，转换会丢语义；错误信息应该保持 server 声明的字段路径，模型才能正确重试。校验通过后再发送，本地失败不产生网络往返。server 侧仍会校验一次，两层都保留。

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

取消与超时沿用统一执行流水线：`execute` 把 `execution.abort_signal` 传给 MCP 请求，`timeout_ms` 由流水线触发的 abort 实现，不需要在 action 内自己计时。

### 5.4 信任、审批与注入边界

MCP 规范明确要求：除非 server 可信，否则 tool annotations 必须按不可信处理。因此：

| 信任级别 | `access` 推导 | 审批 |
| --- | --- | --- |
| `untrusted`（默认） | 全部工具为 `write` | 全部调用请求审批 |
| `trusted` | `readOnlyHint: true` 为 `read`，其余为 `write` | 仅 `write` 调用请求审批 |

审批通过 `context.interactions.approval.request({ turn_id, tool_call_id, tool_name, description, payload })` 发起，与 `CityAction` 的做法一致。审批模式（ask / always-allow）由实现内部处理，action 不自己读取模式。

非 Session 入口（定时任务、HTTP、RPC）注入的是拒绝式交互端口，没有 `approval`。此时需要审批的调用返回明确失败，说明「无人在场时无法授权」，不静默放行、也不永久挂起。这意味着一份定时任务无法调用未信任 server 的写类工具，这是设计选择而非缺陷。

注入边界有三条硬约束：

1. server 提供的 `name`、`title`、`description`、`inputSchema` 只作为模型侧工具元数据，不进入 `system()`，也不拼进任何 Agent 指令。
2. 工具返回值一律作为外部数据呈现，不解释为指令。文本内容进入 `message` 与 `data`，不写入 `messages[].role = "user"`。
3. `access` 只由本地配置与信任级别推导，server 无法通过注解把写操作声明成读操作来绕过审批。

### 5.5 失败隔离

单个 server 的任何失败都限定在自身范围内：连接失败、握手失败、工具列表异常、单次调用失败都只影响该 server 的投影。`mcp` 的 `status` 动作汇总每个 server 的 `state`、`tool_count`、`last_error` 与 `updated_at`，供模型与 UI 查询。`mcp` 自身不因为某个 server 异常而进入错误状态。

## 6. Desktop 体验

新增 `mcp` 的配置界面，结构参照 `WebPowerSettingsRenderer`：

- server 列表：标题、传输类型、启用开关、连接状态、工具数量、最近错误。
- 新增与编辑：ID、传输表单（stdio 的 command / args / env / cwd，HTTP 的 url / headers）、信任级别、超时与结果上限、工具过滤。
- 连接测试：保存后真实连接一次，展示工具数量与前若干工具名；失败时展示原始错误。
- 手动重载：关闭并重建单个 server 的连接与工具投影。
- 密钥输入框沿用「已配置 / 清空」交互，保存后不回显。

界面需要一句直白的安全提示：stdio server 会在本机执行任意代码，只配置可信来源；HTTP server 由外部服务返回的工具描述与结果同样按不可信处理。

工具面变化在下一个 Step 生效。配置保存后 `provide_power` / `retract_power` 会触发 City 重编译并推送给 Agent，模型在下一轮就能看到新工具，不需要重启。

## 7. 模块划分

```
packages/implementations/powers/src/mcp.ts                          # @downcity/powers/mcp 子路径入口
packages/implementations/powers/src/mcp/Power.ts                    # McpPower：连接所有权、配置差异、投影注册
packages/implementations/powers/src/mcp/ServerPower.ts              # 单 server 投影 Power 定义
packages/implementations/powers/src/mcp/PROMPT.ts                   # 注入模型的最小说明文本
packages/implementations/powers/src/mcp/runtime/Connection.ts       # 单连接：连接、握手、列工具、调用、关闭、重连
packages/implementations/powers/src/mcp/runtime/ConnectionRegistry.ts # 按作用域与空闲超时管理连接
packages/implementations/powers/src/mcp/runtime/Transport.ts        # stdio 与 Streamable HTTP 传输构造
packages/implementations/powers/src/mcp/runtime/ToolProjection.ts   # MCP tool 到 PowerAction 的映射与命名归一化
packages/implementations/powers/src/mcp/runtime/ResultMapping.ts    # MCP 结果到 PowerActionResult 与 messages
packages/implementations/powers/src/mcp/runtime/Validation.ts       # 配置校验、JSON Schema 校验、保留名检查
packages/implementations/powers/src/mcp/host/McpPowerConfigActions.ts # config.read / save / test / reload
packages/implementations/powers/src/mcp/renderer/McpPowerSettingsRenderer.tsx # Desktop 配置界面
packages/implementations/powers/src/mcp/types/McpPower.ts           # 配置与运行状态类型
packages/implementations/powers/src/mcp/types/McpSettings.ts        # 配置草稿、脱敏视图与测试结果类型
```

每个模块保持 800 行以内，类型统一放在 `types/` 下，全部文件写模块级中文文档注释。

配套改动：

- `packages/city/src/power/types/PowerHost.ts` 与 `PowerRuntime.ts` 增加 `PowerProvisioner` 与投影所有权回收。
- `packages/implementations/powers/src/builtin/BuiltinPowerTypes.ts` 增加 `mcp` 注册项（`has_config: true`，无 Sidebar 与 Mainview）。
- `packages/implementations/powers/src/renderers.ts` 增加 `mcp` 渲染器。
- `packages/implementations/powers/package.json` 增加 `./mcp` 导出与 `@modelcontextprotocol/client` 依赖。
- `packages/implementations/powers/readmes/mcp.readme.md` 用户文档。
- `homepage/content/docs/{en,zh}/plugin/mcp.mdx` 与 `meta.json`：面向用户说明如何配置 MCP server。

## 8. 分阶段实施

**第一阶段**

stdio 与 Streamable HTTP 连接、工具投影、调用与文本 / `structuredContent` 结果映射、信任与审批、失败隔离、`status` 动作、配置动作、Desktop 界面、用户文档。

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
6. 删除 server 配置后连接被关闭、子进程退出、投影 Power 被回收；City 关闭后无残留进程。
7. `mcp` 被移除时其全部投影 Power 一并回收。
8. `config.read` 不返回 `env` 与 `headers` 的任何值。
9. 单个 server 连接失败时 City 启动、其他 server 与 Agent 会话创建均正常。
10. 模块行数、类型注释与命名符合仓库工程规范，`pnpm typecheck` 通过。

## 10. 风险与待确认

**SDK 版本。** 当前 MCP 规范最新版是 2026-07-28，已改为无状态模型，移除了 `initialize` 握手与 `Mcp-Session-Id`，并新增 `server/discover`。官方 TypeScript SDK 的 v2（`@modelcontextprotocol/client`）对应这版规范，v1.x（`@modelcontextprotocol/sdk`）对应 2025-06-18。计划锁定 v2，依赖它的向后兼容探测连接旧 server。需要在实施时用一组真实 server（官方 Playwright、Filesystem、GitHub）验证互操作；如果对旧 server 的兼容不足，改锁 v1.x。这个选择会影响第 5 章的生命周期描述，实施前需要用实测确认。

**无状态规范的落点。** v2 不再有连接级会话，`tools/list` 结果不再随连接变化，server 需要跨调用状态时改由工具参数传递不透明句柄。这会简化连接管理，但也意味着「一次连接对应一份工具清单」的假设需要复核。实施时以实测的 SDK 行为为准。

**连接作用域成本。** 按 `(server, agent, workspace)` 建连会让多 Agent 多 Workspace 场景下的子进程数量快速上升。第一阶段接受，如果实测内存压力明显，再评估按 Workspace 共享并加访问隔离。

**工具数量。** 单个 MCP server 可能暴露几十个工具，全部进工具描述会推高每个 Step 的上下文成本。第一阶段靠 `disabled_tools` 手动裁剪；如果实际使用中出现明显的上下文压力，再考虑按需投影或分组。

## 11. 文档与版本

按仓库约定，`@downcity/powers` 与 `@downcity/city` 都发生对外能力变化，提交前用 `pnpm patch:build -- --powers --city` 完成版本自增与构建。用户可见文档写入 `readmes/mcp.readme.md` 与 homepage 的 `plugin/mcp.mdx`，开发设计文档留在 `docs/`。
