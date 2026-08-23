# Downcity SDK 设计哲学与领域边界

> 状态：当前实现基线  
> 更新时间：2026-08-21  
> 适用范围：Downcity 的 City、Agent、Workspace、Plugin、Session、Federation、Shell 与平台适配 SDK。

## 1. 产品意图

Downcity 帮助应用把一个或多个 Agent 放进真实的工作环境中执行任务。一个 Agent 要完成工作，需要两类东西：它自身的行为能力，以及外部提供的工作资源。

`Agent` 表达前者。它有身份、指令、模型、Plugin 和持续的执行状态。`City` 表达后者。它组织项目 Workspace、Embassy、transport 和宿主级基础设施。两者保持独立，应用通过组合它们建立运行时：

```ts
const city = new City({
  embassy,
  workspaces: [project_workspace],
});

const agent = new Agent({
  id: "coder",
  city,
  model,
  instruction: "维护当前项目。",
  plugins: [image_plugin],
});
```

City 不制造 Agent，Agent 也不制造 City。应用拥有装配决策：它决定哪一个 Agent 使用哪一个 City、哪些 Workspace 可用、哪些 Plugin 归属于该 Agent，以及哪些 Embassy 服务被注入 Plugin。

这套模型避免把系统设计成一个由工厂、注册表和转发器主导的框架。调用者面对的主语始终是 Agent；City 为它提供可使用的环境和资源。

## 2. 核心模型

Downcity 的用户模型由五个核心概念组成：

```text
City      Agent 的宿主环境与资源容器
Workspace City 中一个可执行的项目资源单元
Agent     拥有行为、能力与执行状态的主体
Plugin    由 Agent 持有的扩展能力
Session   Agent 在一个 Workspace 中的一次持续执行
```

它们之间的关系是：

```text
应用
  ├─ 创建 City ──────────────── owns ──────> Workspace、Embassy、transport
  └─ 创建 Agent ─────────────── owns ──────> Plugin、Session
                │
                └─ bind ───────────────────> City

Session ── executes in ────────────────────> Workspace
Plugin  ── consumes explicit services ─────> Embassy 或应用注入的服务
```

其中的 `owns` 表示所有权和释放责任，`bind` 表示稳定的资源关联，`executes in` 表示一次执行选择的环境。不要把“可以使用”理解成“拥有”。Agent 可以使用 City 的 Workspace，Plugin 可以调用 Embassy 服务，但它们都不负责释放这些资源。

## 3. 设计原则

### 3.1 主体与容器分离

Agent 是任务的行为主体。它决定何时执行、调用哪些 Tool 和 Plugin、如何维护 Session。City 是宿主环境。它提供资源、统一 transport，并在关闭时收口自己持有的资源。

因此，用户不写 `city.create_agent()`，也不写 `city.create_session()`。这类 API 会让 City 越过容器边界，接管本应属于 Agent 的行为和状态。

### 3.2 一个状态只有一个拥有者

每项长期状态只有一个权威拥有者。共享使用不产生共享所有权。

| 状态或资源 | 权威拥有者 | 使用者 |
| --- | --- | --- |
| Workspace、Shell、Workspace env | City | Agent、Session、Plugin |
| Embassy 与宿主 transport | City | Agent、Plugin、远程客户端 |
| Agent 身份、模型、指令 | Agent | Session、Plugin |
| Plugin 实例与 Agent 级生命周期 | Agent | Session |
| Session 消息、队列、Turn、恢复状态 | Session | Agent、transport |
| Plugin 私有运行时数据 | Agent 下的 Plugin 作用域 | Plugin |

这个规则直接决定释放顺序、并发隔离和失败边界。例如，多个 Agent 可以使用同一个 Workspace，但它们不共享 Session、Plugin 实例或 Agent 私有数据。

### 3.3 显式组合，拒绝隐式工厂

应用在启动处完成对象组合。SDK 不根据 ID、配置字符串或一次 HTTP 请求隐式创建 Agent、Workspace 或 Plugin。

```ts
const image_plugin = new ImagePlugin({ image_ai });

const agent = new Agent({
  id: "designer",
  city,
  plugins: [image_plugin],
});
```

显式 `new` 让实例归属、配置来源和生命周期一眼可见。它也保证有状态 Plugin 不会被 City 意外做成单例。

### 3.4 窄能力依赖，拒绝通用上下文容器

Plugin 不接收 `City`、`Agent` 或泛化的 `ai` 对象。构造函数只接收本能力所需的窄服务接口和自身配置。

```ts
const image_plugin = new ImagePlugin({
  image_ai,
  default_model: "image-model-id",
});

const sound_plugin = new SoundPlugin({
  sound_ai,
  default_asr_model: "asr-model-id",
});
```

`image_ai`、`sound_ai` 可以由 Embassy 的服务入口提供，也可以由应用自己的实现提供。ImagePlugin 不需要知道 Embassy 属于哪个 City，SoundPlugin 也不需要访问 Agent 实例。构造函数表达真实依赖，测试时可以直接替换对应服务。

Agent 在实际调用 Plugin 时投影当前执行所需的上下文：`agent_id`、`workspace_id`、`workspace_path`、文件能力、Shell、Workspace env、Plugin 私有数据目录，以及可选的 `session_id` 和 `turn_id` 快照。这个上下文是 Plugin runtime 协议，不是宿主应用的 Service Container。

### 3.5 在检查点改变状态

Workspace env、Agent 指令、Plugin 注册与 Session 配置都必须经过明确的 API 改变。Session 在一个 Turn 中读取稳定快照；新的配置在下一个检查点生效。这样可以解释一次执行使用了哪些资源，也能避免运行中的上下文在任意语句间漂移。

### 3.6 平台差异留在平台边界

文件、路径、网络和普通进程使用 Node.js 的跨平台能力。Sandbox、PTY、进程组、权限和系统服务等具有操作系统语义的能力，才交给 `@downcity/sandbox-*` 等平台包。

Agent、Session、Plugin 和持久化协议不根据 macOS、Linux 或 Windows 分支。切换系统应当只替换 Workspace 装配的 Shell/Sandbox Adapter。

## 4. 各概念的职责与非职责

### 4.1 City

> City 是给 Agent 提供工作环境和服务资源的容器。

City 持有：

- Workspace 集合及其稳定 ID 索引。
- Embassy 与 City 级服务资源。
- HTTP/RPC transport 和宿主级运行时配置。
- City 所有资源的关闭协调。
- 已绑定 Agent 的内存引用，用于路由和关闭协调。

City 不持有：

- Agent 的身份、模型、指令和业务状态。
- Plugin 实例、Plugin 配置或 Plugin 的 Agent 级生命周期。
- Session 的消息、队列和执行状态。

City 对 Agent 的引用不是所有权转移。应用仍然创建 Agent，Agent 仍然拥有 Plugin 和 Session。City 关闭时会协调已绑定 Agent 的释放，是为了保证宿主环境退出后不会遗留运行中的 Session、Plugin、Shell 或 transport。

### 4.2 Workspace

> Workspace 是 City 向 Agent 提供的项目资源单元。

Workspace 把同一个项目或远程计算环境的资源收敛为一个边界：稳定 ID、根路径、受控文件系统、文件与搜索 Tool、环境变量、可选 Shell、Sandbox 和通用私有存储 Provider。

Workspace 不理解 Agent 的身份、模型、Plugin 或 Session 语义。它不提供 `create_session()`，也不保存 Agent 记忆。Session 只能由 Agent 创建。

一个 City 可以持有多个 Workspace。多个 Agent 也可以使用同一个 Workspace。共享 Workspace 表示共享项目资源，并不表示共享 Session、消息、Plugin 数据或身份。

### 4.3 Agent

> Agent 是唯一的行为主体。

Agent 持有稳定 ID、模型、指令、自定义 Tool、Plugin 实例和创建 Session 的入口。它可以绑定一个 City，也可以不绑定 City。绑定 City 后，Agent 创建 Session 时只能使用该 City 持有的 Workspace 实例。

Agent 不拥有 City 的 Workspace、Embassy 或 transport。它不能替换 City 资源，也不负责宿主基础设施。它只在运行时消费所选 Workspace 和显式注入的服务。

### 4.4 Plugin

> Plugin 是 Agent 的扩展能力。

Plugin 可以提供 Action、Hook、System 文本、Resolve 能力、HTTP route 和生命周期钩子。一个 Plugin 实例只传给一个 Agent；两个 Agent 需要同一类能力时，各自创建实例。

```ts
const reviewer = new Agent({
  id: "reviewer",
  city,
  plugins: [new MemoryPlugin()],
});

const implementer = new Agent({
  id: "implementer",
  city,
  plugins: [new MemoryPlugin()],
});
```

这种规则对 Memory、Task、Chat、Contact 等有状态 Plugin 很重要。它们的数据和运行状态按 Agent/Plugin 作用域隔离，不能因为两个 Agent 位于同一个 City 就共享实例。

Plugin 具有两个生命周期层次：

- Agent 级 `start` / `stop`：适合不依赖项目资源的初始化和清理。
- Workspace 级 `enter_workspace` / `leave_workspace`：适合打开与当前项目有关的资源。

生命周期层次表达资源依赖，不把 Plugin 划分为不同“种类”。任何 Plugin 的 Action 都可以在执行时得到当前 Workspace Context。

### 4.5 Session

> Session 是 Agent 在指定 Workspace 中的一次持续执行。

Session 保存连续对话、输入队列、Turn、Tool 调用、审批、压缩和恢复状态。它属于 Agent。Workspace 只是 Session 本次执行选择的环境。

Session 的归属不会因为它在某个 Workspace 中执行而转移给 Workspace。一个 Workspace 不保存“自己的 Session 集合”；它只提供执行 Session 所需的文件、环境和 Shell。

### 4.6 Embassy 与 Federation

`Federation` 是服务端能力和治理边界，负责模型目录、上游路由、身份、用量、计费和服务策略。`Embassy` 是应用或 City 访问 Federation 服务的客户端入口。

City 可以持有 Embassy，让多个 Agent 在同一宿主环境下使用同一组服务访问能力。Plugin 只接收自己需要的窄服务，例如 `image_ai` 或 `sound_ai`，不会因为使用 Embassy 服务而取得 Federation、City 或其他 Plugin 的控制权。

## 5. 调用方式

### 5.1 标准 City 宿主

这是 CLI、Desktop、Node 服务和自定义宿主的主路径。

```ts
import { Agent } from "@downcity/agent";
import { City } from "@downcity/agent";
import { Workspace } from "@downcity/workspace";
import { ImagePlugin } from "@downcity/plugins";

const project_workspace = new Workspace({
  id: "project",
  path: process.cwd(),
  shell,
});

const city = new City({
  embassy,
  workspaces: [project_workspace],
});

const agent = new Agent({
  id: "coder",
  city,
  model,
  instruction: "维护当前项目。",
  plugins: [
    new ImagePlugin({
      image_ai,
      default_model: "image-model-id",
    }),
  ],
});

const session = await agent.sessions.create({
  workspace: city.workspaces.get("project")!,
});

await session.prompt({ query: "检查当前项目并修复测试。" });
```

`city.agents.add(agent)` 表达已创建的 Agent 加入宿主环境。`agent.sessions.create({ workspace })` 表达这次执行选择哪个环境。两者不是同一件事：加入 City 不等于进入项目，Session 选择 Workspace 也不改变 Agent 的身份或所有权。

### 5.2 一个 Agent 使用多个 Workspace

一个 Agent 可以在不同 Workspace 中创建不同 Session。Agent 的身份、指令和 Plugin 实例保持一致；每个 Workspace 的项目文件、Shell、env 和 Session 存储保持隔离。

```ts
const frontend_session = await agent.sessions.create({
  workspace: city.workspaces.get("frontend")!,
});

const backend_session = await agent.sessions.create({
  workspace: city.workspaces.get("backend")!,
});
```

不要把“当前 Workspace”做成 Agent 的全局可变状态。Workspace 是 Session 创建时的显式参数，因此并发 Session 不会互相抢占项目环境。

### 5.3 多个 Agent 使用同一个 Workspace

多个 Agent 可以协作同一项目：

```ts
const workspace = city.workspaces.get("project")!;

const reviewer = new Agent({ id: "reviewer", model });
const implementer = new Agent({ id: "implementer", model });
city.agents.add(reviewer);
city.agents.add(implementer);

const review_session = await reviewer.sessions.create({ workspace });
const implementation_session = await implementer.sessions.create({ workspace });
```

两个 Session 都能访问同一项目资源。它们的 Session 历史、Plugin 实例、Plugin 私有数据、日志和 Agent 指令仍按 Agent ID 分区。并发修改同一项目文件属于应用或任务层的协作策略，不属于 Workspace 的所有权语义。

### 5.4 不使用 City 的嵌入式 Agent

City 是宿主资源容器，不是 Agent 的强制前置条件。嵌入式应用可以直接创建 Workspace，并把它交给 Agent 的 Session。此时应用没有 City 的 transport、Embassy 索引和统一关闭协调。

```ts
const workspace = new Workspace({
  id: "project",
  path: process.cwd(),
});

const agent = new Agent({
  id: "embedded",
  model,
  plugins: [new MemoryPlugin()],
});

const session = await agent.sessions.create({ workspace });
await session.prompt({ query: "总结这个项目。" });
await agent.dispose();
```

当前实现中，未绑定 City 的 Agent 在 `dispose()` 时释放自己已使用的 Workspace。绑定 City 的 Agent 不会释放 Workspace，City 在 `close()` 时释放它们。应用必须只选择一个拥有者来关闭同一个 Workspace。

### 5.5 远程调用

HTTP/RPC 只是 City 的部署适配器。远程调用仍然面向一个已存在的 Agent 和它的 Session；transport 不在请求期间创建 Agent、Plugin 或 Workspace。

```text
远程请求
  -> City transport 解析 agent_id 与 workspace_id
  -> 已绑定 Agent 创建或恢复自己的 Session
  -> Session 在 City 已持有的 Workspace 中执行
```

应用部署 transport 时调用 `city.listen(...)`。transport 负责协议、鉴权、路由和连接生命周期，不承担 Agent 业务决策。

## 6. Plugin 的资源模型

Plugin 的归属和资源访问经常被混淆。正确模型分成三层：

| 层次 | 负责的事 | 例子 |
| --- | --- | --- |
| 应用装配 | 创建 Plugin 并注入明确服务 | `new ImagePlugin({ image_ai })` |
| Agent | 持有 Plugin 实例并管理其生命周期 | `new Agent({ plugins: [...] })` |
| Session 执行 | 向 Plugin 投影当前 Workspace 与 Session 上下文 | 文件、Shell、`session_id` |

ImagePlugin 的例子说明了边界。应用从 Embassy 或其他 provider 获得图片 AI 服务，构造 ImagePlugin 时显式注入它。Agent 持有该实例。Session 运行 ImagePlugin Action 时，Agent 额外提供当前 Workspace 文件能力，让 Plugin 可以读取参考图或保存结果。

```text
Embassy / application provider
  -> image_ai
  -> ImagePlugin instance
  -> Agent owns the instance
  -> Session supplies Workspace Context for one invocation
```

因此：

- City 不注册 Plugin，也不缓存 Plugin 单例。
- Plugin 不在构造时接收 City 或 Agent。
- Plugin 不自行拼装 `agent_id`、`workspace_id`、`session_id`。
- Plugin 不释放 City 的 Embassy、Workspace、Shell 或 transport。
- Plugin 需要共享外部服务时，应用共享服务客户端，不共享有状态 Plugin 实例。

## 7. 生命周期与释放

资源的创建者承担释放责任。Downcity 的完整关闭顺序如下：

```text
City.close()
  -> 关闭 HTTP/RPC transport，停止接受新请求
  -> dispose 每个已绑定 Agent
      -> 释放 AgentWorkspace 执行资源与 SessionStore
      -> stop 并注销该 Agent 的 Plugin 实例
  -> dispose City 持有的 Workspace、Shell 与 Sandbox 资源
```

City 不拥有 Plugin，但在关闭协调中调用 Agent 的 `dispose()`，让 Agent 清理它自己拥有的 Plugin 和 Session。这是关闭顺序的协调，不是领域所有权转移。

独立 Agent 不交给 City 管理。调用方在结束时只需要调用 `agent.dispose()`；当前 Agent 会清理它已进入的 Workspace。不要在同一生命周期里再手动关闭该 Workspace。

## 8. 数据隔离与持久化

真实项目目录和 Downcity 运行时数据必须分开。

```text
项目目录
  -> Workspace files、搜索和 Shell 的工作目录

~/.downcity/agents/<agent_id>/workspaces/<workspace_id>/
  -> Session、日志、调度等 Agent 在该 Workspace 中的执行数据

~/.downcity/agents/<agent_id>/plugins/<plugin_id>/
  -> 该 Agent 的 Plugin 私有运行时数据
```

Session metadata 同时记录 `agent_id` 与 `workspace_id`。这使恢复、审计和隔离都可以从唯一事实源推导。Plugin 的私有数据不放进项目目录，也不按 Workspace 复制；Workspace 文件能力与 Plugin 私有数据能力是两条不同的访问通道。

## 9. Package 边界与依赖方向

| Package | 对外职责 | 不承担的职责 |
| --- | --- | --- |
| `@downcity/city` | City 资源容器、Agent 路由、HTTP/RPC transport、关闭协调 | Agent 或 Plugin 工厂、Session 领域逻辑 |
| `@downcity/agent` | 单 Agent、Session、执行器、Plugin runtime、远程 Agent client | City 控制面、全局 Agent registry、平台 Sandbox 选择 |
| `@downcity/workspace` | 项目资源、受控文件能力、Workspace Tool、env、可选 Shell 与私有存储 Provider | Agent 身份、模型、Plugin 与 Session 规则 |
| `@downcity/plugins` | 可复用 Plugin 实现及其窄服务协议 | City 注册表、宿主生命周期 |
| `@downcity/federation` | Federation 服务端与 Embassy 客户端协议 | 本地 Agent 的 Session 执行 |
| `@downcity/shell` | 命令、进程、PTY、审批与 Sandbox 协议 | 文件系统、Session、模型与 Plugin 业务 |
| `@downcity/sandbox-*` | 操作系统 Sandbox 实现 | Agent、Session、Plugin 领域逻辑 |
| `@downcity/workspace-cloudflare-computer` | 远程计算环境的 Workspace 实现 | Agent 与 City 的生命周期 |
| `downcity` CLI、Desktop | 读取用户配置并显式装配 City、Agent 与 Plugin | 改写 SDK 对象所有权 |

稳定的依赖方向如下：

```text
应用 / CLI / Desktop
  -> City + Workspace + Agent + Plugin 的显式装配
  -> Agent Session runtime
  -> Workspace files / Shell / platform sandbox

Plugin
  -> @downcity/agent 的 Plugin contract
  -> 自身的窄服务接口

Agent
  -> AgentCity 最小协议，而非 @downcity/city 实现
```

`@downcity/agent` 通过最小 `AgentCity` 协议感知 City，避免反向依赖 `@downcity/city`。应用通过 `city.agents.add(agent)` 建立绑定；应用可以替换 City 宿主实现，只要它提供解析 Workspace 和释放 Agent 的必要协议。

## 10. 公开 API 与内部适配层

推荐给 SDK 使用者的最小调用面是：

```ts
const city = new City({ embassy, workspaces });
const agent = new Agent({ id, model, plugins });
city.agents.add(agent);
const session = await agent.sessions.create({ workspace });

await session.prompt({ query });
await city.listen({ http: { port: 5314 } });
await city.close();
```

运行时仍保留内部 `AgentWorkspace` 和 `City.enter_workspace()`，用于 transport、CLI、Desktop 的装配；它们不再从公开 Agent API 暴露。用户只通过 `city.agents.*` 管理主体，通过 `agent.sessions.create({ workspace })` 创建活动。

这些能力不改变公开心智模型：

- 用户不需要把 `AgentWorkspace` 当作主体概念。
- 用户不通过内部运行时对象表达“Agent 加入 Workspace”的业务状态；Session 创建本身就是一次 Agent 在 Workspace 中的活动。
- 用户不通过 `City.enter_workspace()` 在请求中隐式创建资源。
- 用户创建 Session 时显式指定已有 Workspace。

后续公开 API 收敛应继续把这类执行桥接能力留在内部或 transport 适配层，不能重新引入 `create_agent`、`workspace.create_session`、`city.register_plugin` 或 Plugin 单例管理。

## 11. 设计检查清单

新增 SDK 能力前，按以下顺序判断归属：

1. 用户想完成什么工作，最小可理解的概念是什么？
2. 哪个对象拥有该状态或资源，并负责失败和释放？
3. 其他对象是在使用该能力，还是也需要拥有它？
4. 下层是否被迫理解上层业务？如是，应把依赖改为窄协议或上移装配。
5. 调用者是否需要直接接触该 API？如不需要，不公开它。
6. 该能力能否通过组合已有对象完成？如能，不新增 `Manager`、`Host`、`Registry` 或通用 Context。

下面的判断可以快速避免边界退化：

| 问题 | 正确归属 |
| --- | --- |
| 谁提供项目文件、env、Shell 与 Sandbox？ | Workspace，由 City 持有 |
| 谁创建并运行持续对话？ | Agent 创建 Session |
| 谁拥有任务、记忆、聊天等扩展实例？ | Agent 拥有 Plugin |
| 谁提供图片或语音模型服务？ | City 所持有的 Embassy 或应用注入的 Provider |
| 谁负责选择本次执行的项目环境？ | 调用 `agent.sessions.create` 的应用 |
| 谁关闭宿主资源？ | City；独立模式由 Agent 清理已使用 Workspace |
| 谁决定平台 Sandbox 实现？ | 宿主装配 Workspace 时选择平台包 |

## 12. 结论

Downcity 用容器与主体的关系组织 SDK：City 提供环境和资源，Agent 组织行为和执行。Workspace 是资源边界，Plugin 是 Agent 能力，Session 是 Agent 在某个 Workspace 中的一次执行。

调用者用少量显式对象就能表达完整系统：先创建 City 和 Workspace，再创建持有 Plugin 的 Agent，最后由 Agent 创建选择 Workspace 的 Session。所有更底层的路由、Context、Store、Shell 和 transport 都应维护这条关系，而不改变它。
