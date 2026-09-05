# @downcity/city

`@downcity/city` 是 Downcity 的应用组合根。它统一持有 Agent、Group、Workspace、Plugin 生命周期与 HTTP/RPC transport。

```ts
import { Agent } from "@downcity/agent";
import { City, Workspace } from "@downcity/city";

const workspace = new Workspace({ id: "main", path: process.cwd() });
const agent = new Agent({ id: "assistant" });
const city = new City({
  workspaces: { main: workspace },
});

city.agents.add(agent);
const session = await agent.sessions.create({ workspace });
```

Agent 可以脱离 City 独立运行；加入 City 后，City 负责共享资源、Plugin 与宿主生命周期。

City 中每个 Plugin ID 只对应一个实例，所有已注册 Agent 自动获得全部 Plugin。Plugin
可以直接传入 `CityOptions.plugins` 或通过 `city.plugins.add()` 动态加入：

```ts
const city = new City({
  agents: { assistant: agent },
  workspaces: { main: workspace },
  plugins: { memory: new MemoryPlugin() },
});
const session = await agent.sessions.create({ workspace });
```

CLI、Desktop 等本地宿主可从 `@downcity/city/local` 导入 `LocalDatabase`、配置
Repository、环境装配和 `LocalPluginLoader`。这些能力只负责本地持久化与装配，不会隐式创建
Agent、Workspace、Model 或 City。
