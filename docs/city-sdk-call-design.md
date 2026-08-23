# City SDK 调用设计

> 状态：设计稿
>
> 目标：从用户调用方式出发，明确 `City`、`Workspace`、`Agent`、`Session` 和 `Plugin` 的关系。
> 本文只定义公开概念和调用方式，不直接修改实现。

## 1. 一句话模型

```text
City      给 Agent 提供工作环境和资源的容器
Workspace City 提供的项目资源单元
Agent     使用资源并执行行为的主体
Session   Agent 的一次持续交互
Plugin    Agent 自己拥有的扩展能力
```

`City` 是容器，`Agent` 是主体。用户创建并操作 Agent；Agent 绑定 City 后，按需使用 City 的 Workspace 和其他资源。

## 2. 基础调用

```ts
const project_workspace = new Workspace({
  id: "project",
  path: "/projects/demo",
});

const city = new City({
  embassy,
  workspaces: [project_workspace],
});

const memory_plugin = new MemoryPlugin();
const task_plugin = new TaskPlugin();

const agent = new Agent({
  id: "coder",
  instruction: "维护当前项目。",
  plugins: [memory_plugin, task_plugin],
});
city.agents.add(agent);

const session = await agent.sessions.create({
  workspace: city.workspaces.get("project"),
});

await session.prompt({ query: "检查当前项目" });
await agent.plugins.memory.search({ query: "项目约定" });
```

这里没有 `city.add(agent)`，也没有 `city.register(plugin)`：

- `new Agent()` 创建 Agent 主体；`city.agents.add(agent)` 将已创建的 Agent 纳入 City，City 不提供工厂式创建 Agent 的 API。
- `new MemoryPlugin()` 创建 Plugin 实例；实例随后由 Agent 持有，并在运行时消费 City 提供的资源。
- Session 永远从 Agent 创建，Workspace 只是本次 Session 的执行资源。

## 3. Agent 不使用 City

不依赖文件、Shell 或其他 City 资源时，Agent 可以独立运行：

```ts
const agent = new Agent({
  id: "standalone",
  model,
});

const session = await agent.sessions.create();
await session.prompt({ query: "生成一张图" });
```

Plugin 构造函数不接收 City、Agent 或泛化 `ai`。需要 Embassy 服务时，直接注入对应的窄服务接口；需要 Workspace 文件时，由 Agent 在运行时提供。

## 4. Plugin 的构造与所有权

### 4.1 直接构造实例

Plugin 不在 City 注册。应用或用户直接构造实例，再传给 Agent：

```ts
const memory_plugin = new MemoryPlugin();
const agent = new Agent({
  id: "coder",
  plugins: [memory_plugin],
});
city.agents.add(agent);
```

City 不保存 Plugin 类型、Plugin ID、Definition 或 Factory。不存在 `city.plugins`、`city.create_plugin()` 或 `plugins: ["memory"]` 这类注册式 API。

### 4.2 消费 City 资源

插件需要 City 资源时，不在构造函数中注入 City；Agent 会在运行时把当前可用能力投影给 Plugin：

```ts
const web_plugin = new WebPlugin();
```

如果 Plugin 需要外部实现，构造函数只接收明确的 Provider；这个 Provider 可以由应用或 City 的资源层创建：

```ts
const memory_plugin = new MemoryPlugin({
  provider: memory_provider,
});
```

ImagePlugin 直接使用 Embassy 提供的图片 AI 服务：

```ts
const image_plugin = new ImagePlugin({
  image_ai: embassy.user.ai,
  default_model: "image-model-id",
});
```

Workspace、Shell、Agent ID 和 Session ID 等运行时能力由 Agent 投影给 Plugin；Embassy 的具体服务在 Plugin 构造时显式注入。SDK 不要求用户理解额外的 `PluginDefinition`、`PluginSetupContext` 或通用 Service Container。

### 4.3 作用域和生命周期

```text
Plugin package    定义能力和构造函数
Plugin instance   由应用创建，唯一归一个 Agent
Agent             启动、调用和释放自己的 Plugin
City              拥有宿主资源，Agent 在运行时将其投影给 Plugin
Session           提供一次调用的 Workspace / Session 执行边界
```

同一个 Plugin package 可以被多个 Agent 使用，但必须创建多个实例：

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

City 不拥有 Plugin runtime，因此不会因为多个 Agent 共用一个 City 而共享 Memory、Contact、Task、Chat、Web 等有状态实例。

### 4.4 Agent、Workspace、Session 标识从哪里来

Plugin 可能需要 `agent_id`、`workspace_id` 或 `session_id`，但用户不手动把这些 ID 塞进 City 或每次调用参数：

- `agent_id` 来自拥有该实例的 Agent。
- `workspace_id` 来自当前 Session 选择的 Workspace。
- `session_id` 来自当前调用的 Session。

Agent 在执行 Plugin 时通过内部运行协议提供这些信息。这个协议不作为用户需要理解的公共 Context 类型；Plugin 的公开方法只保留业务参数。

```ts
await agent.plugins.task.create({ title: "修复测试" });
```

## 5. Workspace 场景

### 5.1 一个 Agent 使用多个 Workspace

Agent 不需要加入或退出 Workspace，也不维护公开的 presence 状态。每个 Session 创建时选择已有 Workspace：

```ts
const frontend_session = await agent.sessions.create({
  workspace: city.workspaces.get("frontend"),
});

const backend_session = await agent.sessions.create({
  workspace: city.workspaces.get("backend"),
});
```

两个 Session 共享 Agent 身份和 Plugin 实例，但文件、Shell、环境变量和 Session 状态按 Workspace 隔离。

### 5.2 一个 Workspace 被多个 Agent 使用

```ts
const workspace = city.workspaces.get("project");

const reviewer = new Agent({ id: "reviewer" });
const implementer = new Agent({ id: "implementer" });
city.agents.add(reviewer);
city.agents.add(implementer);

const review_session = await reviewer.sessions.create({ workspace });
const implementation_session = await implementer.sessions.create({ workspace });
```

Workspace 是共享资源容器，不拥有任何 Agent 的 Session 或 Plugin。两个 Agent 的消息、Plugin 状态和执行上下文必须隔离。

### 5.3 共享物理目录

是否允许多个 Workspace 指向同一物理目录，由 City 的资源策略决定；用户仍然显式创建 Workspace：

```ts
const read_workspace = new Workspace({
  id: "read-only",
  path: "/projects/demo",
  access: "read_only",
});

const write_workspace = new Workspace({
  id: "write",
  path: "/projects/demo",
  access: "read_write",
});
```

City 不根据请求隐式创建 Workspace，也不通过 `enter_workspace()` 改变 Agent 状态。

## 6. City 资源和生命周期

City 拥有 Workspace、Embassy、transport 以及其他 City 级资源。Plugin 可以持有这些资源的引用，但不因此取得资源所有权。

```ts
await city.listen({
  http: { host: "127.0.0.1", port: 5314 },
});

await city.close();
```

关闭顺序由 City 统一协调：

```text
停止接收新请求
  -> 停止绑定 Agent 的活动 Session
  -> Agent 释放自己的 Plugin 实例
  -> 释放 Workspace 和 Embassy
  -> 关闭 transport
```

City 可以持有绑定 Agent 的运行时引用，但不接管 Agent 的身份、业务状态或 Plugin 所有权。未绑定 City 的独立 Agent 仍可自行 `dispose()`。

## 7. HTTP / RPC

Transport 是 City 的部署适配器，不改变用户面向 Agent 的调用方式：

```ts
const city = new City({ workspaces, embassy });
const agent = new Agent({ id: "assistant" });
city.agents.add(agent);

await city.listen({
  http: { host: "127.0.0.1", port: 5314 },
});
```

远程客户端获得的是 Agent 视图：

```ts
const remote_agent = new RemoteAgent({
  base_url: "http://127.0.0.1:5314/agents/assistant",
});

const session = await remote_agent.sessions.create({
  workspace_id: "project",
});
```

Transport 只解析已存在的 Agent、Session 和 Workspace，不在请求期间创建 Agent、Plugin 或 Workspace。

## 8. CLI / Desktop 装配

CLI 和 Desktop 可以读取配置，但最终仍使用同一套对象关系：

```ts
const city = new City(city_runtime_options);

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

await city.listen(listen_options);
```

CLI 和 Desktop 可以根据配置决定实例化哪些 Plugin，但实例化动作仍然是应用层的显式 `new Plugin(...)`；City 不知道配置文件中有哪些 Plugin，也不负责根据 Plugin ID 创建实例。

## 9. 最小公开 API

```ts
class City {
  constructor(options: CityOptions);
  workspace(workspace_id: string): Workspace;
  listen(options: CityListenOptions): Promise<void>;
  close(): Promise<void>;
}

class Agent {
  constructor(options: AgentOptions);
  readonly sessions: AgentSessions;
  readonly plugins: AgentPlugins;
  dispose(): Promise<void>;
}

class Session {
  prompt(input: PromptInput): Promise<Turn>;
}
```

`AgentPlugins` 只暴露当前 Agent 已经拥有的实例；不暴露注册、安装、Factory 或通用上下文管理 API。

## 10. 需要切换的现有设计

### 10.1 City 注册 Plugin

```ts
// 删除
const city = new City({ plugins: [memory_definition] });

// 目标
const memory_plugin = new MemoryPlugin();
const agent = new Agent({ id: "coder", plugins: [memory_plugin] });
city.agents.add(agent);
```

### 10.2 City 创建 Agent

```ts
// 删除
const agent = new Agent(agent_options);
city.agents.add(agent);

// 目标
const agent = new Agent(agent_options);
city.agents.add(agent);
```

### 10.3 Agent 进入 Workspace

```ts
// 删除
const session = await agent.sessions.create({ workspace });
const session = await agent.sessions.create();

// 目标
const session = await agent.sessions.create({ workspace });
```

### 10.4 Workspace 创建 Session

```ts
// 删除
const session = await workspace.create_session(agent.id);

// 目标
const session = await agent.sessions.create({ workspace });
```

## 11. 验收标准

1. 用户通过 `new Agent()` 创建和操作 Agent，City 不提供 Agent 工厂。
2. `city.agents.add(agent)` 是已创建 Agent 获取 City 资源的主路径；不需要额外的绑定工厂函数。
3. City 构造函数只描述它拥有的 Workspace 和 City 级资源。
4. Plugin 由用户或应用直接 `new`，构造函数只接收自身配置或明确的 Provider；City 不注册 Plugin。
5. Plugin 实例唯一归 Agent，Agent 负责其运行和释放。
6. Agent 不持有泛化 `ai`；Plugin 分别声明并接收自己的服务接口。
7. Plugin 所需的 Agent / Workspace / Session 标识由 Agent 内部运行时提供，不形成新的公开 Context 概念。
8. Session 的创建入口位于 Agent，Workspace 是显式执行上下文。
9. 不存在公开的 `join`、`leave`、`presence`、`enter_workspace`、`create_plugin` 等中间动作。
10. HTTP/RPC 只是 City 的 transport 适配器，不改变 Agent 的主体模型。
