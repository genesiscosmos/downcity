# @downcity/city

`@downcity/city` 是给 Agent 提供 Workspace、Embassy 和 transport 的资源容器。
它不创建 Agent、Session 或 Plugin。

```ts
import { Agent } from "@downcity/agent";
import { Workspace } from "@downcity/workspace";
import { City } from "@downcity/city";

const workspace = new Workspace({ id: "sdk", path: "/projects/sdk" });
const city = new City({ embassy, workspaces: [workspace] });
const agent = new Agent({ id: "lucas", model, plugins });
city.agents.add(agent);
const session = await agent.sessions.create({ workspace: city.workspace("sdk")! });

const agents = city.agents.list();
const current_agent = city.agents.get("lucas");

await city.close();
```

Agent 拥有自己的 Plugin 和 Session；City 负责 Workspace、Embassy、transport 以及关闭时的资源协调。

## 公开能力

- `City`：Workspace、Embassy 与 transport 生命周期
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

AgentWorkspace、Session、Plugin SDK 和 RemoteAgent 位于
`@downcity/agent`；Workspace 资源位于 `@downcity/workspace`。Federation、Embassy 与 Bureau 位于
`@downcity/federation`。

CLI 与 Desktop 使用包内的宿主协调 API 登记 City 进程所有权。状态保存在
`~/.downcity/runtimes/city/host.json`；接管方先获得用户确认，再请求已有宿主优雅退出，
等待原进程释放 transport 后才能登记新宿主。
