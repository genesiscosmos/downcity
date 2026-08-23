# City SDK 重新设计 PRD

> 状态：设计确认稿
>
> 更新时间：2026-08-21
>
> 范围：`@downcity/agent`、`@downcity/agent`、`@downcity/plugins` 的公开概念、调用方式、资源所有权和生命周期。

## 1. 产品结论

Downcity 的运行模型只有五个核心概念：

```text
City      给 Agent 提供工作环境和服务资源的容器
Workspace City 提供的项目资源单元
Agent     使用资源并执行行为的主体
Plugin    Agent 持有的扩展能力
Session   Agent 的一次持续交互
```

最重要的关系是：

```text
City 提供资源
Agent 持有 Plugin 并消费资源
Plugin 扩展 Agent 的行为
Session 在指定 Workspace 中执行
```

## 2. City

### 2.1 定义

> **City 是给 Agent 提供工作环境和资源的容器。**

City 是运行环境，不是 Agent 工厂，也不是 Plugin 注册中心。

### 2.2 City 拥有的内容

City 拥有并管理：

- Workspace 集合。
- Embassy 以及 Embassy 提供的服务客户端。
- City 级存储、配置和基础设施连接。
- HTTP/RPC transport。
- 上述资源的启动、停止和释放过程。

City 可以向多个 Agent 提供同一项底层服务，例如 Embassy 的图片 AI 服务；但共享的是服务资源，不是 Plugin 实例。

### 2.3 City 不负责的内容

City 不负责：

- 创建 Agent。
- 创建 Session。
- 执行 Agent 的业务动作。
- 注册或创建 Plugin。
- 持有 Agent 的 Plugin 实例。
- 通过请求隐式创建 Workspace。

City 可以保存已绑定 Agent 的运行时引用，用于路由和关闭协调，但不因此取得 Agent 或 Plugin 的领域所有权。

### 2.4 City 的公开调用

```ts
const city = new City({
  embassy,
  workspaces: [project_workspace],
});

const workspace = city.workspaces.get("project");

await city.listen({
  http: { host: "127.0.0.1", port: 5314 },
});

await city.close();
```

City 不提供以下 API：

```ts
new Agent({ id: "assistant" });
city.add(agent);
city.create_plugin(...);
city.register_plugin(...);
city.enter_workspace(...);
```

## 3. Workspace

### 3.1 定义

> **Workspace 是 City 提供给 Agent 工作和访问项目资源的容器单元。**

Workspace 是共享资源容器，一个 Workspace 可以同时服务多个 Agent 的多个 Session。

### 3.2 Workspace 拥有的内容

Workspace 可以提供：

- 稳定 ID。
- 项目根目录或远程计算环境。
- 文件读写和搜索能力。
- 环境变量。
- Shell 和 Sandbox。
- Workspace 级存储和工具。

Workspace 不拥有：

- Agent 身份。
- Plugin 实例。
- Session。
- Agent 指令、模型或记忆。

### 3.3 Workspace 的生命周期

Workspace 交给 City 后，由 City 负责其生命周期。用户不在 City 运行期间单独释放或替换 Workspace。

Workspace 不提供以下 Agent 领域 API：

```ts
workspace.create_session(agent_id);
workspace.session(agent_id);
```

Session 永远由 Agent 创建。

## 4. Agent

### 4.1 定义

> **Agent 是行为主体，拥有身份、指令、Plugin 实例和 Session 集合。**

Agent 可以独立创建，也可以在创建时绑定 City：

```ts
const standalone_agent = new Agent({
  id: "standalone",
});

const city_agent = new Agent({
  id: "coder",
  city,
});
```

一个 Agent 同时只能绑定一个 City。没有绑定 City 的 Agent 只能使用自己显式持有的模型、Plugin 和其他基础能力。

### 4.2 Agent 的职责

Agent 负责：

- 持有稳定身份和指令。
- 持有 Plugin 实例。
- 创建、恢复和释放 Session。
- 在 Session 执行时选择 Workspace。
- 向 Plugin 投影当前 Agent、Workspace 和 Session 的运行时能力。
- 在自身释放时停止并释放 Plugin。

Agent 不负责：

- 管理 City 的 Workspace 生命周期。
- 管理 Embassy 或 City 级服务生命周期。
- 创建 Plugin 类型或从 Plugin ID 安装 Plugin。
- 维护全局 Agent registry。

### 4.3 Agent 与 City 的绑定

绑定是 Agent 与宿主环境之间的稳定关系，不是 Workspace 的进入动作：

```ts
const agent = new Agent({
  id: "coder",
  city,
});
```

不公开 `enter()`、`join()`、`presence()`、`leave()` 等 Workspace 绑定状态。Session 每次显式选择已有 Workspace 即可。

## 5. Session

### 5.1 定义

> **Session 是 Agent 的一次持续交互。**

Session 永远归 Agent 所有。Workspace 只是 Session 的执行上下文，不是 Session 的拥有者。

```ts
const session = await agent.sessions.create({
  workspace: city.workspaces.get("project"),
});

await session.prompt({
  query: "检查当前项目",
});
```

### 5.2 多 Workspace

同一个 Agent 可以创建使用不同 Workspace 的 Session：

```ts
const frontend_session = await agent.sessions.create({
  workspace: city.workspaces.get("frontend"),
});

const backend_session = await agent.sessions.create({
  workspace: city.workspaces.get("backend"),
});
```

两个 Session 共享 Agent 身份和 Plugin 实例，但文件、Shell、环境变量、消息和执行状态按 Session / Workspace 隔离。

### 5.3 多 Agent 共享 Workspace

```ts
const workspace = city.workspaces.get("project");

const reviewer = new Agent({ id: "reviewer" });
const implementer = new Agent({ id: "implementer" });
city.agents.add(reviewer);
city.agents.add(implementer);

const review_session = await reviewer.sessions.create({ workspace });
const implementation_session = await implementer.sessions.create({ workspace });
```

Workspace 可以共享项目资源，但两个 Agent 的 Session、指令、Plugin 状态和运行时上下文必须隔离。

## 6. Plugin

### 6.1 定义

> **Plugin 是 Agent 的扩展能力。**

Plugin 可以向 Agent 增加：

- Actions。
- Hooks。
- System instructions。
- Resolve 能力。
- HTTP routes。
- 长期运行的 Plugin runtime。

Plugin 不是 City 资源。Plugin 可以消费 City 提供的资源，但不因此改变所有权。

```text
City      拥有 Embassy、Workspace 和服务资源
Agent     拥有 Plugin 实例
Plugin    使用服务资源并扩展 Agent 行为
Session   提供当前调用的执行上下文
```

### 6.2 Plugin 的构造

Plugin 由应用或用户直接构造，再传给 Agent：

```ts
const image_plugin = new ImagePlugin({
  image_ai: embassy.user.ai,
  default_model: "image-model-id",
});

const agent = new Agent({
  id: "designer",
  city,
  plugins: [image_plugin],
});
```

Plugin 构造函数不接收 `City`、`Agent` 或通用 `ai` 对象。它只接收：

- Plugin 自身配置。
- Plugin 需要的明确服务接口。
- Plugin 自己创建或持有的外部 Adapter。

这样 Plugin 的依赖边界是可见且可测试的。

### 6.3 ImagePlugin 初始化

ImagePlugin 需要图片生成服务，因此依赖一个窄接口，而不是完整 Embassy：

```ts
export interface ImageAiService {
  /** 查询可用图片模型。 */
  catalog(): Promise<ImageModelCatalog>;

  /** 创建图片生成任务。 */
  image_create(input: JsonObject): Promise<JsonValue>;

  /** 查询图片生成任务。 */
  image_result(input: JsonObject): Promise<JsonValue>;
}
```

Embassy 的图片 AI 客户端只需要满足这个接口即可：

```ts
const image_plugin = new ImagePlugin({
  image_ai: embassy.user.ai,
  default_model: "image-model-id",
});
```

Agent 不需要持有 `ai`：

```ts
const agent = new Agent({
  id: "designer",
  city,
  plugins: [image_plugin],
});
```

ImagePlugin 在执行 Action 时直接使用自己持有的 `image_ai`；需要读写项目文件时，再使用 Agent 在运行时提供的 Workspace 文件能力：

```text
image_ai       构造时注入，来源可以是 Embassy
agent_id       Agent 运行时提供
workspace files Agent 运行时提供
session_id     当前 Session 运行时提供
```

### 6.4 Plugin 接口

不引入面向用户的 `PluginDefinition`、`PluginSetupContext`、`PluginRegistration` 或 Factory。Plugin 的定义就是 Plugin 接口和具体实现类：

```ts
export interface Plugin {
  /** Plugin 的稳定名称。 */
  readonly name: string;

  /** Plugin 的 Action 集合。 */
  readonly actions?: PluginActions;

  /** Plugin 的 Hook 集合。 */
  readonly hooks?: PluginHooks;

  /** Plugin 的生命周期。 */
  readonly lifecycle?: PluginLifecycle;

  /** Plugin 提供给 Agent 的 system 内容。 */
  system?(
    context: PluginContext,
  ): string | Promise<string>;
}
```

这里的 `PluginContext` 是 Plugin 作者实现 Action 时使用的扩展协议，不是普通 SDK 用户需要手动创建或传入的对象。Agent 在执行 Plugin 时内部生成它。

### 6.5 Plugin 所有权

```text
Plugin package       定义 Plugin 类和类型
Plugin instance      由应用创建，唯一归一个 Agent
Agent                启动、调用和释放 Plugin
City service         被 Plugin 借用，不由 Plugin 释放
```

同一个 Plugin package 可以被多个 Agent 使用，但每个 Agent 都创建自己的实例：

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

Plugin 内部可以按 Workspace 或 Session 管理自己的运行态，但不跨 Agent 共享实例状态。

### 6.6 Plugin 与 City 服务的所有权

如果 Plugin 使用 City 或 Embassy 提供的服务：

1. City 或 Embassy 创建并拥有服务客户端。
2. 应用把服务的窄接口传给 Plugin。
3. Plugin 只保存服务引用并调用它。
4. Plugin 不负责释放 City / Embassy 服务。
5. City 关闭时，先停止依赖服务的 Agent，再释放服务本身。

例如：

```text
City
└── Embassy ImageAiService

Agent
└── ImagePlugin
    └── borrowed ImageAiService
```

底层连接可以是 City 级单例；Plugin 仍然是 Agent 级实例。共享重资源不等于共享 Plugin。

## 7. 运行时上下文

Plugin 不要求用户在每次调用时手动传入身份信息：

```ts
await agent.plugins.image.image_create({
  prompt: "一张产品展示图",
});
```

Agent 在内部执行 Plugin 时提供：

- `agent_id`：来自 Agent。
- `workspace_id`：来自当前 Session 选择的 Workspace。
- `session_id`：来自当前 Session。
- `files`：当前 Workspace 的文件能力。
- `shell`：当前 Workspace 的 Shell。
- `data_files`：当前 Agent / Plugin 的私有数据能力。
- `logger`：当前运行时日志能力。

这些能力属于一次执行的内部上下文，不升级为用户需要装配的公共容器对象。

## 8. 生命周期

### 8.1 创建和释放

创建资源的对象负责关闭资源：

```text
City 创建 Workspace / Embassy / Transport
  -> City 释放 Workspace / Embassy / Transport

Agent 接收 Plugin 实例
  -> Agent 释放 Plugin 实例

Plugin 创建内部 Provider / Worker
  -> Plugin 释放内部 Provider / Worker
```

### 8.2 City 关闭

City 关闭时的协调顺序：

```text
停止接收新请求
  -> 通知绑定 Agent 停止活动 Session
  -> Agent 停止并释放 Plugin
  -> 释放 Workspace 资源
  -> 释放 Embassy 和 City 服务
  -> 关闭 transport
```

City 负责协调顺序，但不直接接管 Plugin 的生命周期实现。Plugin 的 `start` / `stop` 仍由 Agent 调用。

### 8.3 Agent 关闭

```ts
await agent.dispose();
```

Agent 释放所有 Session、Workspace 运行作用域和 Plugin。独立 Agent 即使没有绑定 City，也可以正常释放自己的资源。

## 9. 典型调用场景

### 9.1 单 Agent、单 Workspace

```ts
const workspace = new Workspace({
  id: "project",
  path: "/projects/demo",
});

const city = new City({
  embassy,
  workspaces: [workspace],
});

const agent = new Agent({
  id: "coder",
  city,
  plugins: [
    new MemoryPlugin(),
    new TaskPlugin(),
  ],
});

const session = await agent.sessions.create({ workspace });
await session.prompt({ query: "检查当前项目" });
```

### 9.2 ImagePlugin

```ts
const image_plugin = new ImagePlugin({
  image_ai: embassy.user.ai,
  default_model: "image-model-id",
});

const agent = new Agent({
  id: "designer",
  city,
  plugins: [image_plugin],
});
```

### 9.3 一个 Agent 使用多个 Workspace

```ts
const agent = new Agent({
  id: "architect",
  city,
  plugins: [new MemoryPlugin()],
});

const frontend_session = await agent.sessions.create({
  workspace: city.workspaces.get("frontend"),
});

const backend_session = await agent.sessions.create({
  workspace: city.workspaces.get("backend"),
});
```

### 9.4 一个 Workspace 使用多个 Agent

```ts
const workspace = city.workspaces.get("project");

const reviewer = new Agent({
  id: "reviewer",
  city,
  plugins: [new MemoryPlugin()],
});

const implementer = new Agent({
  id: "implementer",
  city,
  plugins: [new TaskPlugin()],
});

await reviewer.sessions.create({ workspace });
await implementer.sessions.create({ workspace });
```

### 9.5 远程 Agent

远程客户端仍然面向 Agent，而不是面向 City transport：

```ts
const remote_agent = new RemoteAgent({
  base_url: "http://127.0.0.1:5314/agents/coder",
});

const session = await remote_agent.sessions.create({
  workspace_id: "project",
});
```

远程 Agent 不直接暴露本地 Plugin 实例；Plugin action 通过 Agent 协议执行。

## 10. Package 边界

```text
@downcity/agent
├── City
├── Workspace
├── Embassy / City service binding
└── HTTP / RPC transport

@downcity/agent
├── Agent
├── Session
├── Plugin contract and runtime
└── RemoteAgent

@downcity/plugins
├── ImagePlugin
├── MemoryPlugin
├── TaskPlugin
└── other Agent capabilities
```

依赖方向：

```text
Plugin -> 最小服务接口和 Agent Plugin contract
Agent  -> Plugin contract、Workspace protocol
City   -> Agent、Workspace、Embassy adapter
```

Plugin 不依赖具体 City 类，也不依赖完整 Embassy 类型。City 和 Embassy 通过符合 Plugin 所需窄接口的服务实现完成组合。

## 11. 迁移方向

### 11.1 删除 Agent 级泛化 AI

```ts
// 删除
const agent = new Agent({
  id: "designer",
  ai: embassy.user.ai,
});

// 目标
const agent = new Agent({
  id: "designer",
  plugins: [
    new ImagePlugin({ image_ai: embassy.user.ai }),
  ],
});
```

`ImagePlugin`、`SoundPlugin` 等 Plugin 分别声明自己的服务接口，Agent 不再持有一个包含所有模态的 `ai` 聚合对象。

### 11.2 删除 City Plugin 注册

```ts
// 删除
const city = new City({
  plugins: [memory_definition, task_definition],
});

// 目标
const city = new City({ embassy, workspaces });
const agent = new Agent({
  id: "coder",
  city,
  plugins: [new MemoryPlugin(), new TaskPlugin()],
});
```

### 11.3 删除 Workspace Session API

```ts
// 删除
const session = await workspace.create_session(agent.id);

// 目标
const session = await agent.sessions.create({ workspace });
```

### 11.4 删除 Agent Workspace 中间对象

```ts
// 删除
const session = await agent.sessions.create({ workspace });

// 目标
const session = await agent.sessions.create({ workspace });
```

## 12. 非目标

本 PRD 不要求：

- City 自动发现、安装或恢复 Plugin。
- City 根据 Plugin ID 创建 Plugin 实例。
- Agent 持有通用 `ai`、`web` 或 Service Container。
- Plugin 直接持有完整 City、Agent 或 Embassy 对象。
- Workspace 保存 Agent 配置、Session 历史或 Plugin 实例。
- 为兼容旧 API 保留 `AgentWorkspace`、`enter_workspace` 或 `city.add` 公开别名。

## 13. 验收标准

1. `City` 的核心含义是宿主环境和资源容器。
2. `Agent` 是用户创建和操作的主体。
3. `Workspace` 由 City 拥有，可以服务多个 Agent，但不拥有 Session。
4. `Session` 的创建入口位于 Agent。
5. Plugin 实例由应用直接创建并唯一归 Agent。
6. Plugin 构造函数不接收 City、Agent 或泛化 `ai`。
7. Plugin 只接收自身配置和明确的服务接口，例如 `ImageAiService`。
8. ImagePlugin 可以直接使用 Embassy 提供的图片 AI 服务。
9. Agent 不再持有泛化 `ai` 属性。
10. City 不注册、不创建、不持有 Plugin 实例。
11. City 级共享服务可以是单例，但 Plugin 实例不能跨 Agent 共享。
12. Agent 在运行时向 Plugin 提供 Agent、Workspace、Session 和文件能力。
13. City、Agent、Plugin 和 Workspace 的生命周期边界可以独立说明和测试。
