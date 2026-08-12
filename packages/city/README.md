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
- `AgentHTTP` 与 `AgentRPC`：独立暴露一个 Agent
- `CityHTTP` 与 `CityRPC`：在两个 City 级端口上按 Agent ID 暴露全部 Agent

```ts
const http = new CityHTTP(city);
await http.server().listen({ host: "127.0.0.1", port: 5314 });

const rpc = new CityRPC(city);
await rpc.listen({ host: "127.0.0.1", port: 15314 });
```

对应的远程地址是：

```text
http://127.0.0.1:5314/agents/<agent_id>
rpc://127.0.0.1:15314/<agent_id>
```

单 Agent 的 Workspace、Session、Plugin SDK 和 RemoteAgent 位于
`@downcity/agent`。Federation、Embassy 与 Bureau 位于
`@downcity/federation`。
