# @downcity/server

`@downcity/server` 是 Downcity 的本机传输适配层。

包内只做两件事：

- `AgentRPC`：把一个本地 `Agent` 通过 NDJSON over TCP 暴露成本机 RPC 服务，配合 `RemoteAgent("rpc://...")` 使用。
- `AgentHTTP`：把 `Agent` 暴露成最小 SDK HTTP 面（`/api/sdk/sessions/*`），可作为独立 HTTP 服务启动，也可作为 Hono 子路由挂到调用方自己的服务器上。

`@downcity/server` 不承载业务实现。Agent 的 session、plugin、executor 能力仍由 `@downcity/agent` 提供。

## 安装

```bash
pnpm add @downcity/agent @downcity/server
```

## 用法

```ts
import { Agent, Workspace } from "@downcity/agent";
import { AgentRPC, AgentHTTP } from "@downcity/server";

const workspace = new Workspace({ path });
const agent = new Agent({
  id,
  workspace,
  model,
});
await agent.ready();

const rpc = new AgentRPC(agent);
await rpc.listen({ host: "127.0.0.1", port: 15314 });

const http = new AgentHTTP(agent);
await http.server().listen({ host: "127.0.0.1", port: 5314 });

// 或者把 router 挂到自己的 Hono 上：
import { Hono } from "hono";
const app = new Hono();
app.route("/", http.router());
```

停机：

```ts
await rpc.close();
await http.close();
await agent.dispose();
```

## 设计要点

- AgentRPC 仅封装 NDJSON over TCP，不带 auth；本机使用。
- AgentHTTP 仅承载 RemoteAgent SDK transport；平台级路由请由调用方自行装配。
- AgentRPC / AgentHTTP 都是按需启动，互不依赖。
