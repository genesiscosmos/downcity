# @downcity/city

`@downcity/city` 是 Downcity 的 Agent 宿主环境。它管理一个 Store 下的 Agent
实例集合，并提供 CLI、Desktop 等本地宿主共用的持久化装配与可选网络能力。

```ts
import { City, LocalCityStore } from "@downcity/city";

const city = new City(new LocalCityStore());
await city.ready();

const agents = city.agents();
const agent = city.agent("lucas_whitman");

await city.dispose();
```

City 不给 Agent 增加启动或停止状态。Agent 即使不处于 CLI daemon 或 Desktop
长期宿主中，仍然可以直接创建 Session 并执行 `session.prompt()`。

## 公开能力

- `City`、`CityStore`、`MemoryCityStore`
- `LocalCityStore` 与 `~/.downcity/downcity.db` 本地装配
- `AgentHTTP` 与 `AgentRPC`

单 Agent 的 Workspace、Session、Plugin SDK 和 RemoteAgent 位于
`@downcity/agent`。Federation、Embassy 与 Bureau 位于
`@downcity/federation`。
