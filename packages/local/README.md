# @downcity/local

`@downcity/local` 的根入口只提供数据库、加密和路径基础设施。Agent、Workspace、Plugin
等产品数据组件位于明确的 `@downcity/local/product` 子入口。这个包不创建 Agent、
Workspace 或 Model，也不管理 City 生命周期。

```ts
import {
  LocalCrypto,
  LocalDatabase,
} from "@downcity/local";
import {
  AgentRepository,
  WorkspaceRepository,
  ensure_local_schema,
} from "@downcity/local/product";

const database = new LocalDatabase({ filename: database_path });
ensure_local_schema(database);

const crypto_adapter = new LocalCrypto(root_path);
const workspaces = new WorkspaceRepository(database, crypto_adapter);
const agents = new AgentRepository(database, crypto_adapter, workspaces);
```

## 边界

- `LocalDatabase` 只提供 `query`、`execute`、`prepare`、`transaction` 和 `close`，不理解 Agent、Workspace 或 Plugin。
- `@downcity/local/product` 属于本地产品数据层，负责具体配置结构和查询规则。
- `LocalPluginLoader` 只根据安装记录、Binding 与 Resource 创建 Plugin 实例。
- CLI 与 Desktop 是组合根：它们读取配置、显式 `new Agent()`，并负责释放所创建的资源。
