# @downcity/workspace-cloudflare-computer

Cloudflare Computer Workspace 适配器。

这个包把 Cloudflare Durable Object 中的 `@cloudflare/computer` Workspace 接入 Downcity Agent。Agent 仍负责模型、Session、Plugin 和 Tool Loop；Cloudflare Computer 负责持久化文件和远程执行后端。

```ts
import { getWorkspace } from "@cloudflare/computer";
import { Agent } from "@downcity/agent";
import { CloudflareComputerWorkspace } from "@downcity/workspace-cloudflare-computer";

const computer_workspace = await getWorkspace(agent_stub);

const workspace = new CloudflareComputerWorkspace({
  computer: computer_workspace,
  dispose: () => computer_workspace[Symbol.dispose](),
});

const agent = new Agent({
  id: "research-agent",
  workspace,
  model,
});
```

适配器内部使用 Cloudflare Computer 官方 `createAITools()` 创建文件、目录和发布工具，并自动封装 Computer Shell 为 `exec` 工具。调用方不需要配置工具；`exec` 默认使用 Computer 已配置的默认 backend，模型也可以在调用时显式选择 backend id。

当前 Cloudflare Computer 仍是 Preview API。生产部署前应固定兼容版本，并为远程 Workspace 断线、Runtime 冷启动和 Stub 释放增加宿主级监控。
