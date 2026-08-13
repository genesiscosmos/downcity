# @downcity/city

`@downcity/city` 是 Downcity 的 Agent 宿主环境。它管理一个 Store 下的 Agent
实例集合，并提供 CLI、Desktop 等本地宿主共用的配置装配与可选网络能力。

```ts
import { City, LocalCityEnvironment, LocalCityStore } from "@downcity/city";

const store = new LocalCityStore();
const environment = new LocalCityEnvironment({ data_source: store });
const city = new City(store, environment);
await city.ready();

const agents = city.agents();
const agent = city.agent("lucas_whitman");

await city.dispose();
```

`CityStore` 只提供 `CityAgentConfig`，`CityEnvironment` 把配置转换成运行时
`AgentOptions`，`City` 调用 `new Agent()` 并持有实例。`city.add/remove` 不修改配置，
Plugin 生命周期归 Agent。

## 公开能力

- `City`、`CityStore`、`MemoryCityStore`
- `LocalCityStore`：读写 `~/.downcity/downcity.db` 的纯数据 Adapter
- `LocalCityEnvironment`：本地 Workspace、Shell、Sandbox、Model 与 Plugin Adapter
- `AgentHTTP` 与 `AgentRPC`：独立暴露一个 Agent
- `CityHTTP` 与 `CityRPC`：在两个 City 级端口上按 Agent ID 暴露全部 Agent

```ts
await city.listen({
  http: { host: "127.0.0.1", port: 5314 },
  rpc: { host: "127.0.0.1", port: 15314 },
});
```

对应的远程地址是：

```text
http://127.0.0.1:5314/agents/<agent_id>
rpc://127.0.0.1:15314/<agent_id>
```

单 Agent 的 Workspace、Session、Plugin SDK 和 RemoteAgent 位于
`@downcity/agent`。Federation、Embassy 与 Bureau 位于
`@downcity/federation`。
