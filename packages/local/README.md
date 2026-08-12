# @downcity/local

`@downcity/local` 是 Downcity CLI 与 Desktop 共用的本地 City Store Adapter。

它统一管理 `~/.downcity/downcity.db` 中的 Agent、Workspace、Plugin Binding、Plugin
Resource、第三方 Plugin 安装记录以及本地 Embassy User Session。它不负责 CLI 命令、
Desktop 窗口或 daemon 生命周期。

```ts
import { City } from "@downcity/agent";
import { LocalCityStore } from "@downcity/local";

const city = new City(new LocalCityStore());
await city.ready();
const agent = city.agent("assistant");
```

一个持久化 Agent 绑定一个 Workspace，一个 Workspace 可以被多个 Agent 使用。CLI 和
Desktop 共享同一数据库，但每个宿主拥有独立的 City 实例和运行生命周期。
