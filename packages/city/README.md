# @downcity/city

`@downcity/city` 是 Downcity 的应用组合根。它统一持有 Agent、Group、Workspace、Plugin 生命周期与 HTTP/RPC transport。

```ts
import { Agent } from "@downcity/agent";
import { City } from "@downcity/city";
import { Workspace } from "@downcity/workspace";

const workspace = new Workspace({ id: "main", path: process.cwd() });
const agent = new Agent({ id: "assistant" });
const city = new City({ workspaces: [workspace] });

city.agents.add(agent);
const session = await agent.sessions.create({ workspace });
```

Agent 可以脱离 City 独立运行；加入 City 后，City 负责共享资源、Plugin 与宿主生命周期。

CLI、Desktop 等本地宿主可从 `@downcity/city/local` 导入 `LocalDatabase`、配置
Repository、环境装配和 `LocalPluginLoader`。这些能力只负责本地持久化与装配，不会隐式创建
Agent、Workspace、Model 或 City。
