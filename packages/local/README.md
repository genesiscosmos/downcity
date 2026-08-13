# @downcity/local

`@downcity/local` 提供 Downcity 本地产品使用的数据库原语、配置 Repository 和
Plugin Loader。它不创建 Agent、Workspace 或 Model，也不管理 City 生命周期。

```ts
import {
  AgentRepository,
  LocalCrypto,
  LocalDatabase,
  WorkspaceRepository,
  ensure_local_schema,
} from "@downcity/local";

const database = new LocalDatabase({ filename: database_path });
ensure_local_schema(database);

const crypto_adapter = new LocalCrypto(root_path);
const workspaces = new WorkspaceRepository(database, crypto_adapter);
const agents = new AgentRepository(database, crypto_adapter, workspaces);
```

## 边界

- `LocalDatabase` 只提供 `query`、`execute`、`prepare`、`transaction` 和 `close`，不理解 Agent、Workspace 或 Plugin。
- `ensure_local_schema` 与各 Repository 属于本地产品数据层，负责具体配置结构和查询规则。
- `LocalPluginLoader` 只根据安装记录、Binding 与 Resource 创建 Plugin 实例。
- CLI 与 Desktop 是组合根：它们读取配置、显式 `new Agent()`，并负责释放所创建的资源。
