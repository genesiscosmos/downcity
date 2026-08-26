# @downcity/local

`@downcity/local` 的根入口只提供数据库和路径基础设施。Agent、Workspace、Group、Plugin
等产品数据组件位于明确的 `@downcity/local/product` 子入口。这个包不创建 Agent、
Workspace 或 Model，也不管理 City 生命周期。

```ts
import {
  LocalDatabase,
} from "@downcity/local";
import {
  AgentRepository,
  GroupRepository,
  WorkspaceRepository,
  ensure_local_schema,
} from "@downcity/local/product";

const database = new LocalDatabase({ filename: database_path });
ensure_local_schema(database);

const workspaces = new WorkspaceRepository(database);
const agents = new AgentRepository(root_path);
const groups = new GroupRepository(database);
```

## 边界

- `LocalDatabase` 只提供 `query`、`execute`、`prepare`、`transaction` 和 `close`，不理解 Agent、Workspace 或 Plugin。
- `@downcity/local/product` 属于本地产品数据层，负责具体配置结构和查询规则。
- Workspace 与平台设置以明文 JSON 保存；数据库文件权限限制为当前用户可读写。
- GroupRepository 只保存 Group 定义，不创建运行时 Group；Desktop 或其他组合根负责将定义装配到 City。
- Group 定义只保存身份、成员和协作说明；Workspace 在创建 GroupSession 时由组合根显式传入，未填写时使用内存执行上下文。
- `LocalPluginLoader` 只根据 Agent Plugin 引用、Plugin 定义和 profile 创建 Plugin 实例。
- CLI 与 Desktop 是组合根：它们读取配置、显式 `new Agent()`，并负责释放所创建的资源。
