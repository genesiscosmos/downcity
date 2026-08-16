# @downcity/city

`@downcity/city` 是 Agent 内存索引与 HTTP/RPC 转发器。它不读取配置、不创建
Agent，也不访问数据库。

```ts
import { Agent, Workspace } from "@downcity/agent";
import { City } from "@downcity/city";

const agent = new Agent({ id: "lucas", model, plugins });
const workspace = new Workspace({ id: "sdk", path: "/projects/sdk" });
agent.enter(workspace);
const city = new City([agent]);

const agents = city.agents();
const current_agent = city.agent("lucas");

await city.close();
await agent.dispose();
```

宿主拥有 Agent 生命周期。`city.add(agent)` 和 `city.remove(agent_id)` 只修改内存索引，
不会创建、释放或持久化 Agent。Plugin 生命周期归 Agent。

## 公开能力

- `City`：Agent 内存索引与 transport 生命周期
- `AgentHTTP` 与 `AgentRPC`：独立暴露一个 AgentWorkspace
- `CityHTTP` 与 `CityRPC`：在两个 City 级端口上按 Agent ID 与 Workspace ID 暴露执行边界

```ts
await city.listen({
  http: { host: "127.0.0.1", port: 5314 },
  rpc: { host: "127.0.0.1", port: 15314 },
});
```

对应的远程地址是：

```text
http://127.0.0.1:5314/agents/<agent_id>/workspaces/<workspace_id>
rpc://127.0.0.1:15314/<agent_id>/<workspace_id>
```

单 Agent 的 Workspace、Session、Plugin SDK 和 RemoteAgent 位于
`@downcity/agent`。Federation、Embassy 与 Bureau 位于
`@downcity/federation`。

CLI 与 Desktop 使用包内的宿主协调 API 登记 City 进程所有权。状态保存在
`~/.downcity/runtimes/city/host.json`；接管方先获得用户确认，再请求已有宿主优雅退出，
等待原进程释放 transport 后才能登记新宿主。
