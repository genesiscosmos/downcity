# Downcity Organizations Service 重设计

> 身份边界更新：本文已实现的 Organization 关系与治理模型继续有效；其中 `city` 作用域、`city_id` 与 `scope_city_id` 已被 [`federation-bureau-city-identity-redesign.md`](./federation-bureau-city-identity-redesign.md) 取代，当前实现使用 `bureau`、`bureau_id` 与 `scope_bureau_id`。

> 状态：已实现
>
> 所属系统：Downcity Federation
>
> Service ID：`organizations`
>
> 取代范围：`docs/federation-organizations-service-design.md` 中把 Organization 与 City Server 绑定的设计
>
> 核心边界：Organization 只拥有组织身份、成员关系和组织治理；产品后端、部署路由和产品资源权限由 City/Product/Bureau 负责

## 1. 背景

当前 Organizations Service 把 Organization 与一个 `server_url` 绑定，并根据 Membership 签发 audience 指向该 URL 的 `organization_token`。Membership 被移除、Organization 被归档或 URL 发生变化时，Federation 再向该 URL 投递撤权事件。

这套实现混合了两类职责：

- Organization 维护一组用户之间的组织关系；
- Product Runtime 决定产品后端在哪里运行，以及客户端应访问哪个可信服务。

`server_url`、Token audience 和撤权投递目标描述产品部署。它们不描述 Organization。当前模型还允许 Organization Owner 修改后端地址，使组织治理角色同时获得产品基础设施路由权限。

本次重设计移除这层绑定，让 Organizations Service 回到单一职责。

## 2. 产品意图

Organizations Service 回答三个问题：

1. 一个 Organization 是什么；
2. 哪些 Federation User 属于该 Organization；
3. 用户在 Organization 治理中拥有什么角色。

Organizations Service 不回答：

- 产品后端部署在哪里；
- City 应向哪个 Bureau 发请求；
- Organization 在某个产品中拥有哪些资源；
- 用户能否读取、编辑或删除某个产品资源；
- 产品后端如何分片、迁移或容灾。

## 3. 系统职责

### 3.1 Federation

Federation 是以下数据的权威事实源：

- Federation User；
- Organization；
- Membership；
- Join Request；
- Organization 治理角色和生命周期。

Federation 使用 `user_token` 识别用户和当前 `city_id`。Organizations Service 不信任请求 Body 自报的 `user_id` 或 `city_id`。

### 3.2 City

City 是终端产品客户端。它持有：

- `federation_url`；
- 当前用户的 `user_token`；
- 产品预先配置的 Bureau 地址。

City 运行在用户设备上，不属于可信服务端边界。Bureau 必须验证 Token，不能因为请求来自 City SDK 就信任请求内容。

### 3.3 Bureau

Bureau 是可信产品后端。它负责：

- 使用 Federation JWKS 验证 `user_token`；
- 校验 issuer、audience、有效期和 `city_id`；
- 按需查询 Federation 中的 Membership；
- 维护产品 Tenant、资源和产品权限；
- 决定 Organization 如何映射到部署、分片或私有实例。

Bureau 地址来自产品配置或 Federation 管理控制面，不来自 Organization。

### 3.4 Organizations Service

Organizations Service 负责：

- 创建、读取、更名和归档 Organization；
- 管理 Membership；
- 管理 Owner、Admin、Member 治理角色；
- 管理用户主动发起的 Join Request；
- 管理 Organization 的 Federation 全局或 City 作用域；
- 维护 Owner 数量额度和领域事务不变量。

Organizations Service 不负责：

- 保存 `server_url`；
- 签发 `organization_token`；
- 向 Bureau 或其他服务器投递撤权事件；
- 保存 Product Tenant 或 Deployment；
- 管理项目资源权限；
- 发现、探测或监控产品后端。

## 4. 信任模型

### 4.1 `user_token` 可以发送给 Bureau

City 可以把 `user_token` 发送给当前产品预先配置的可信 Bureau。请求必须使用 HTTPS。

```text
City
  -> user_token
  -> Product Bureau
  -> Bureau 本地验证 Federation 签名和 city_id
  -> Bureau 查询或缓存 Membership
  -> Bureau 执行产品资源权限
```

Bureau 收到 Bearer Token 后必须：

1. 只信任预先配置的 Federation issuer；
2. 使用 Federation JWKS 验证签名；
3. 校验 `aud`、`exp`、`nbf` 和必要 Claims；
4. 确认 Token 中的 `city_id` 属于当前产品允许的范围；
5. 不把 Token 写入日志、错误信息或持久化业务记录；
6. 不把 Token 转发给产品配置之外的第三方。

### 4.2 信任 Bureau，不信任任意 URL

Organization Owner 只拥有组织治理权限。Owner 不能注册 Bureau、修改产品后端地址或决定 Token audience。

如果产品允许每个 Organization 使用不同的部署，产品控制面维护独立的绑定：

```text
ProductOrganizationDeployment
  - city_id
  - organization_id
  - deployment_id
  - endpoint
```

该模型属于 Product/Bureau，不进入 Organizations Service 的公共类型、数据库或 API。

### 4.3 Bureau 失陷风险

`user_token` 是 Bearer Token。Bureau 泄露 Token 后，攻击者可能在 Token 过期前冒充用户。产品部署必须使用 HTTPS，并限制日志、追踪和错误上报中的 Authorization Header。

当前信任模型接受可信 Bureau 复用 `user_token`。未来如果产品后端进入不同信任域，可以新增由 Federation 签发、绑定 Product audience 的交换 Token。该能力属于 Federation 身份协议，不属于 Organization。

## 5. 领域模型

### 5.1 Organization

Organization 是 Federation 中稳定的组织身份。它拥有自己的名称、作用域和生命周期。

```ts
/** Organization 生命周期状态。 */
type OrganizationState = "active" | "archived";

/** Organization 的可用作用域类型。 */
type OrganizationScopeType = "federation" | "city";

/** Federation 中的 Organization 记录。 */
interface OrganizationRecord {
  /** Federation 生成的 Organization 全局稳定主键。 */
  organization_id: string;

  /** 面向用户展示的 Organization 名称。 */
  name: string;

  /** Organization 在整个 Federation 可用，或只在一个 City 中可用。 */
  scope_type: OrganizationScopeType;

  /** City 作用域对应的 City ID；Federation 作用域时固定为空字符串。 */
  scope_city_id: string;

  /** Organization 当前生命周期状态。 */
  state: OrganizationState;

  /** 首次创建 Organization 的 Federation User ID。 */
  created_by: string;

  /** ISO 8601 创建时间。 */
  created_at: string;

  /** ISO 8601 最后更新时间。 */
  updated_at: string;

  /** ISO 8601 归档时间；未归档时为空字符串。 */
  archived_at: string;
}
```

数据库和领域层必须维持以下约束：

- `scope_type = federation` 时，`scope_city_id = ""`；
- `scope_type = city` 时，`scope_city_id` 必须是已存在的 City ID；
- Organization 创建后不能修改作用域；
- Organization 归档后不能恢复；
- `organization_id`、`scope_type` 和 `scope_city_id` 创建后保持不变。

使用 `scope_type` 能区分全局作用域和缺失数据，避免让一个可空 `city_id` 同时表达多种含义。

### 5.2 全局 Organization

`scope_type = federation` 表示 Organization 的成员关系不属于某个产品。持有任意有效 `user_token` 的成员都可以读取和治理该 Organization。

全局不等于公开：

- 未加入的用户不能读取 Organization 详情；
- Organizations Service 不提供公开搜索；
- 加入仍需已知 `organization_id` 并通过 Join Request；
- 产品是否接受该 Organization，由产品自己的策略决定。

### 5.3 City Organization

`scope_type = city` 表示 Organization 只在 `scope_city_id` 对应的产品范围内可用。

Organizations Service 对每个请求执行：

```text
user_token.city_id == organization.scope_city_id
```

不匹配时返回 `403 ORGANIZATION_CITY_MISMATCH`。请求 Body 不能覆盖 Token 中的 `city_id`。

### 5.4 Membership

Membership 表示一个 Federation User 与一个 Organization 之间的一段成员关系。

```ts
/** Organization 治理角色。 */
type OrganizationRole = "owner" | "admin" | "member";

/** Membership 生命周期状态。 */
type OrganizationMembershipState = "active" | "removed";

/** User 与 Organization 之间的一段独立成员关系。 */
interface OrganizationMembershipRecord {
  /** 每次成功加入时生成的唯一 Membership ID。 */
  membership_id: string;

  /** Membership 所属 Organization。 */
  organization_id: string;

  /** Membership 所属 Federation User。 */
  user_id: string;

  /** 当前 Organization 治理角色。 */
  role: OrganizationRole;

  /** 当前 Membership 生命周期状态。 */
  state: OrganizationMembershipState;

  /** ISO 8601 创建时间。 */
  created_at: string;

  /** ISO 8601 最后更新时间。 */
  updated_at: string;

  /** ISO 8601 移除时间；active 时为空字符串。 */
  removed_at: string;

  /** 执行移除的用户 ID；主动退出时等于自身。 */
  removed_by: string;
}
```

同一 `(organization_id, user_id)` 同时最多存在一个 active Membership。用户退出或被移除后，Service 永久保留旧记录。用户重新加入时创建新的 `membership_id`。

### 5.5 Join Request

用户通过已知的 `organization_id` 主动申请加入。Organizations Service 不提供公开目录或按名称搜索。

```ts
/** Join Request 生命周期状态。 */
type OrganizationJoinRequestState =
  | "pending"
  | "approved"
  | "rejected"
  | "canceled";

/** 用户主动申请加入 Organization 的记录。 */
interface OrganizationJoinRequestRecord {
  /** Join Request 稳定主键。 */
  request_id: string;

  /** 目标 Organization。 */
  organization_id: string;

  /** 申请用户 ID。 */
  user_id: string;

  /** Join Request 当前状态。 */
  state: OrganizationJoinRequestState;

  /** ISO 8601 申请时间。 */
  requested_at: string;

  /** ISO 8601 决策或取消时间；pending 时为空字符串。 */
  decided_at: string;

  /** 决策用户 ID；用户取消时为自身。 */
  decided_by: string;
}
```

同一用户在同一 Organization 同时最多存在一个 pending Join Request。

## 6. 治理角色

Organization Role 只控制组织治理操作。

| 操作 | Owner | Admin | Member |
| --- | --- | --- | --- |
| 读取 Organization | 允许 | 允许 | 允许 |
| 读取成员列表 | 允许 | 允许 | 允许 |
| 修改 Organization 名称 | 允许 | 允许 | 拒绝 |
| 列出 Join Request | 允许 | 允许 | 拒绝 |
| 批准或拒绝 Join Request | 允许 | 允许 | 拒绝 |
| 移除 Member | 允许 | 允许 | 拒绝 |
| 移除 Admin | 允许 | 拒绝 | 拒绝 |
| 任命或撤销 Admin | 允许 | 拒绝 | 拒绝 |
| 转移 Owner | 允许 | 拒绝 | 拒绝 |
| 归档 Organization | 允许 | 拒绝 | 拒绝 |
| 主动退出 | 转移 Owner 后允许 | 允许 | 允许 |

Organization Role 不表达产品中的 editor、viewer、billing_admin、repository_push 等权限。Bureau 根据自己的资源模型管理这些角色。

每个 active Organization 必须恰好拥有一个 active Owner。Owner 不能直接退出或被移除；Owner 必须先完成所有权转移。

## 7. Organization 创建与额度

### 7.1 创建输入

```ts
/** 创建 Federation 全局 Organization 的输入。 */
interface FederationOrganizationCreateInput {
  /** Organization 展示名称。 */
  name: string;

  /** 明确声明 Federation 全局作用域。 */
  scope_type: "federation";
}

/** 创建 City Organization 的输入。 */
interface CityOrganizationCreateInput {
  /** Organization 展示名称。 */
  name: string;

  /** 明确声明 City 作用域。 */
  scope_type: "city";
}

/** 创建 Organization 的判别联合输入。 */
type OrganizationCreateInput =
  | FederationOrganizationCreateInput
  | CityOrganizationCreateInput;
```

创建 City Organization 时，Service 从 `user_token.city_id` 写入 `scope_city_id`。客户端不提交 `scope_city_id`。

### 7.2 创建权限

任何持有有效 `user_token` 的用户都可以在额度内创建 Organization，并成为唯一 Owner。

Service 使用 Federation 范围的 Owner 额度：

```ts
new OrganizationsService({
  max_organizations_per_user: 3,
});
```

额度统计用户当前作为 Owner 持有的全部 active Organization，不按 City 重复计算。归档 Organization 或转移 Owner 会释放原 Owner 的额度。

额度槽位由独立表和唯一约束维护，避免并发创建突破上限。

## 8. 用户访问流程

### 8.1 调用 Federation Organizations Service

City 使用 `user_token` 直接调用 Federation：

```ts
const organizations = city.service("organizations");

const my = await organizations.get("my");

const membership = await organizations.get("membership/get", {
  organization_id: "org_01J...",
});
```

Federation 验证 Token 后从 Claims 读取 `user_id` 和 `city_id`。

### 8.2 调用产品 Bureau

City 从产品可信配置取得 Bureau URL，并发送原始 `user_token`：

```ts
const response = await city.post(
  "https://bureau.example.com/v1/projects",
  { organization_id: "org_01J..." },
);
```

Bureau 按以下顺序授权：

1. 验证 `user_token`；
2. 确认 `user_token.city_id` 属于当前产品；
3. 从请求或资源记录取得 `organization_id`；
4. 向 Federation 查询当前用户的 active Membership；
5. 确认资源归属于该 `organization_id`；
6. 执行 Bureau 自己的产品权限策略。

Bureau 不能相信客户端额外提交的资源归属。例如读取项目时，Bureau 先从自己的数据库读取 `project.organization_id`，再执行 Membership 和产品权限检查。

### 8.3 Membership 查询

Bureau 可以携带用户提交的同一个 `user_token` 请求 Federation：

```text
GET /v1/organizations/membership/get?organization_id=org_01J...
Authorization: Bearer <user_token>
```

返回成功表示当前用户拥有 active Membership。被移除的 Membership 返回 `403 NOT_AN_ORGANIZATION_MEMBER`。

Bureau 可以使用短时缓存降低查询频率。缓存时长和失效风险由产品负责；要求即时撤权的操作必须在线查询 Federation。Organizations Service 不再维护跨服务器 Outbox。

## 9. Federation API

公开路由前缀：

```text
/v1/organizations/{action}
```

### 9.1 Action 列表

| Method | Action | 最低身份 | 说明 |
| --- | --- | --- | --- |
| `GET` | `my` | User | 列出当前用户加入的 Organization |
| `GET` | `get` | Member | 读取 Organization 和当前 Membership |
| `POST` | `create` | User | 创建 Organization 并成为 Owner |
| `POST` | `update` | Admin | 修改 Organization 名称 |
| `POST` | `archive` | Owner | 不可恢复地归档 Organization |
| `GET` | `membership/get` | Member | 读取当前用户 Membership |
| `GET` | `members/list` | Member | 列出 active Membership |
| `POST` | `members/role` | Owner | 设置 Admin 或 Member |
| `POST` | `members/remove` | Owner/Admin | 移除允许管理的 Membership |
| `POST` | `members/leave` | Member/Admin | 主动退出 Organization |
| `POST` | `owner/transfer` | Owner | 原子转移唯一 Owner |
| `POST` | `join-requests/create` | User | 申请加入已知 Organization |
| `POST` | `join-requests/cancel` | Request Owner | 取消自己的 pending 申请 |
| `GET` | `join-requests/list` | Owner/Admin | 列出 pending 申请 |
| `POST` | `join-requests/decide` | Owner/Admin | 批准或拒绝申请 |

重设计后删除：

| 删除 Action | 原因 |
| --- | --- |
| `POST server/update` | 产品后端路由不属于 Organization |
| `POST token/create` | Bureau 直接验证 `user_token` |
| `POST events/deliver` | Service 不再投递跨服务器撤权事件 |

### 9.2 `my`

默认返回当前用户拥有 active Membership 的 active Organization：

```text
GET /v1/organizations/my
```

可选查询参数：

```text
include_archived=true
```

返回项包含当前用户的 `role` 和 `membership_id`。Federation 全局 Organization 在任意 City Token 下可见；City Organization 只在 Token City 匹配时可见。

### 9.3 `get` 与 `membership/get`

两个 Action 都要求当前用户具有 active Membership：

```text
GET /v1/organizations/get?organization_id=org_01J...
GET /v1/organizations/membership/get?organization_id=org_01J...
```

`get` 返回 Organization 和当前 Membership。`membership/get` 是供用户和 Bureau 执行成员关系检查的窄接口，可以保持同一返回结构，避免增加另一套事实模型。

### 9.4 `create`

创建 Federation 全局 Organization：

```json
{
  "name": "Genesis Research",
  "scope_type": "federation"
}
```

创建当前 City Organization：

```json
{
  "name": "Genesis Research",
  "scope_type": "city"
}
```

Service 在一个事务中创建：

- Organization；
- Owner Membership；
- Owner quota slot。

### 9.5 归档

归档是不可恢复的终态。归档事务执行：

- 将 Organization 标记为 `archived`；
- 记录 `archived_at`；
- 释放 Owner quota slot；
- 保留 Membership 和 Join Request 历史。

归档后停止治理写入。产品资源如何归档或删除，由 Bureau 决定。

## 10. 数据库设计

Organizations Service 使用四张逻辑表：

```text
organizations
organization_memberships
organization_owner_slots
organization_join_requests
```

删除：

```text
organization_events
```

### 10.1 `organizations`

核心字段：

```text
organization_id  primary key
name
scope_type       federation | city
scope_city_id    city scope 时为 City ID，否则为空字符串
state            active | archived
created_by
created_at
updated_at
archived_at
```

表中不再保存：

```text
city_id
server_url
```

原来的 `city_id` 由明确的 `scope_type + scope_city_id` 取代。`server_url` 直接删除。

### 10.2 约束

数据库 Adapter 必须在 SQLite、PostgreSQL 和 D1 中表达等价约束：

- Organization 主键唯一；
- active Organization 只有一个 active Owner；
- 同一用户在同一 Organization 同时最多一个 active Membership；
- 同一用户在同一 Organization 同时最多一个 pending Join Request；
- 同一用户的 Owner quota slot 唯一；
- 同一 Organization 只占用一个 Owner quota slot；
- Federation scope 的 `scope_city_id` 为空；
- City scope 的 `scope_city_id` 非空。

### 10.3 事务边界

以下操作必须原子提交：

- 创建 Organization、Owner Membership 和 quota slot；
- 批准 Join Request 和创建 Membership；
- 移除 Membership；
- 转移 Owner 角色和 quota slot；
- 归档 Organization 和释放 quota slot。

Organizations Service 只使用 `context.transaction()` 和 `context.table()`。它不判断数据库类型，也不访问底层 Driver。

## 11. 错误语义

| HTTP | Code | 含义 |
| --- | --- | --- |
| `400` | `ORGANIZATION_INPUT_INVALID` | 输入字段缺失或格式错误 |
| `400` | `ORGANIZATION_SCOPE_INVALID` | 作用域组合不合法 |
| `401` | `AUTH_REQUIRED` | 缺少有效 `user_token` |
| `403` | `ORGANIZATION_CITY_MISMATCH` | Token City 与 City Organization 不一致 |
| `403` | `NOT_AN_ORGANIZATION_MEMBER` | 当前用户没有 active Membership |
| `403` | `ORGANIZATION_ROLE_DENIED` | Organization Role 不允许操作 |
| `404` | `ORGANIZATION_NOT_FOUND` | Organization 不存在或对当前用户不可见 |
| `404` | `ORGANIZATION_MEMBERSHIP_NOT_FOUND` | Membership 不存在 |
| `404` | `JOIN_REQUEST_NOT_FOUND` | Join Request 不存在或不可操作 |
| `409` | `ORGANIZATION_LIMIT_REACHED` | Owner 创建额度已满 |
| `409` | `OWNER_TRANSFER_REQUIRED` | 当前操作会移除唯一 Owner |
| `410` | `ORGANIZATION_ARCHIVED` | Organization 已归档 |

接口不得通过错误差异向非成员泄露 City Organization 的名称、成员或作用域信息。

## 12. 公开类型与 SDK

`@downcity/services` 继续导出：

- `OrganizationsService`；
- Organization、Membership、Join Request 类型；
- SQLite 和 PostgreSQL schema；
- 所有公开 Action 的输入类型。

删除以下公开类型：

- `OrganizationTokenClaims`；
- `OrganizationTokenIssueResult`；
- `OrganizationEventRecord`；
- `OrganizationEventType`；
- `OrganizationRevocationEvent`；
- `OrganizationServerUpdateInput`；
- `organization_token_ttl` 和 Organizations Service `fetch` 配置。

`OrganizationsServiceOptions` 变为：

```ts
/** Organizations Service 初始化选项。 */
interface OrganizationsServiceOptions {
  /** 每个用户最多同时拥有的 active Organization 总数。 */
  max_organizations_per_user: number;
}
```

## 13. 安全要求

### 13.1 Federation

- 从已验证 Token 读取 `user_id` 和 `city_id`；
- 不接受 Body 自报身份；
- 对 City Organization 强制校验 Token City；
- 不公开 Organization 搜索；
- 对非成员隐藏 Organization 详情；
- 使用事务和唯一约束维护唯一 Owner 与 Membership；
- 不向用户控制的 URL 发起请求。

### 13.2 City

- 只向产品预先配置的 HTTPS Bureau 地址发送 `user_token`；
- 不从 Organization API 响应读取或拼装 Bureau URL；
- 不把 `organization_id` 当成授权结果；
- 不在本地长期保存额外的 Organization Capability Token。

### 13.3 Bureau

- 本地验证 Federation JWT；
- 校验当前产品允许的 `city_id`；
- 不记录 Authorization Header；
- 对高风险操作在线读取 Membership；
- 从服务端资源记录读取 `organization_id`；
- 在 Membership 通过后继续执行产品权限检查。

## 14. 缓存与撤权

Organizations Service 删除 Organization Token 和撤权 Outbox 后，Federation 数据库中的 Membership 成为唯一授权事实。

Bureau 可以选择：

- 每次请求在线查询 Membership，得到即时撤权；
- 对低风险读取使用短时缓存；
- 对写入、管理和敏感数据操作强制在线查询。

缓存键至少包含：

```text
federation_issuer
user_id
organization_id
membership_id 或 Membership 更新时间
```

产品必须明确缓存 TTL。Membership 被移除后，最长撤权延迟等于 Bureau 的缓存 TTL。Organizations Service 不替产品隐式决定这一风险。

## 15. 可观测性与审计

Organizations Service 应记录领域审计，但不能记录 Bearer Token。审计事件至少覆盖：

- Organization 创建、更新和归档；
- Join Request 创建、取消、批准和拒绝；
- Membership 创建、角色变化和移除；
- Owner 转移。

审计记录应包含：

- `organization_id`；
- 操作者 `user_id`；
- 目标 `membership_id` 或 `request_id`；
- 操作类型；
- 发生时间；
- 成功或失败结果。

领域审计不等于跨服务器撤权 Event。具体审计存储可以由 Federation 通用审计能力承载，本次实现不为此增加 Organizations 私有 Outbox。

## 16. 迁移方案

本项目不保留旧 API 的向后兼容入口。部署仍需遵守安全切换顺序，不能在旧 Bureau 继续接受 `organization_token` 时删除撤权能力。

### Phase 1：Bureau 与 City 预备

1. Bureau 增加 `user_token` 验证和 Membership 在线查询；
2. Bureau 保持旧链路可用，但产品新代码不再依赖 Organization 返回后端地址；
3. City 从产品可信配置取得 Bureau URL；
4. 在测试环境验证 `user_token + organization_id` 的完整产品授权链路；
5. 盘点仍在接受 `organization_token` 的全部产品后端。

### Phase 2：领域与 Schema

1. 从 `OrganizationRecord` 删除 `server_url` 和旧 `city_id`；
2. 新增 `scope_type` 和 `scope_city_id`；
3. 删除 Organization Event 类型和表；
4. 将 Owner quota 调整为 Federation 用户总额度；
5. 更新 SQLite、PostgreSQL 和 D1 schema contract。

旧数据迁移规则：

- 原 `city_id` 非空的 Organization 转成 `scope_type = city`；
- 原 `city_id` 写入 `scope_city_id`；
- 在安全切换完成后丢弃 `server_url`；
- 在所有 Bureau 拒绝 `organization_token` 后删除已投递和未投递的 Organization Event；
- 根据 active Owner Membership 重建 Federation 范围的 quota slot；
- 如果同一 Owner 超过新额度，迁移必须失败并要求运维明确处理，不能静默丢弃 Organization。

### Phase 3：Service、API 与安全切换

1. 停止签发新的 `organization_token`；
2. 切换 City，使产品请求携带 `user_token`；
3. 切换 Bureau，使其拒绝 `organization_token` 并只接受新链路；
4. 确认所有产品后端完成切换；
5. 删除 `update_server()`；
6. 删除 `issue_token()`；
7. 删除 `deliver_pending_events()`；
8. 删除 `OrganizationEventDispatcher`；
9. 删除路由 `server/update`、`token/create`、`events/deliver`；
10. 更新 Organization scope 校验；
11. 更新 `my` 的全局与 City 过滤规则；
12. 保持 Membership、Join Request 和 Owner 治理事务。

如果无法确认所有旧 Bureau 已拒绝 `organization_token`，Federation 必须继续保存并投递旧撤权 Event，直到旧 Token 的最大 TTL 结束。不能通过删除 Outbox 跳过这段撤权窗口。

### Phase 4：清理 Product 旧接入

1. 删除 Bureau 中的 Organization Token 验证和撤权状态表；
2. 删除客户端对 `organization_token` 和 `server_url` 的依赖；
3. Bureau 通过 `membership/get` 查询 Membership；
4. Bureau 自己维护 Product Tenant、资源归属和部署绑定；
5. 删除不再使用的旧撤权端点。

### Phase 5：文档与发布

1. 更新 homepage Organizations 概览与 API Reference；
2. 删除 City Server 接入 Organization Token 的文档；
3. 增加 Bureau Membership 授权示例；
4. 更新 `@downcity/services` README；
5. 使用多 Package patch 脚本 bump 实际发生公开变化的 Package；
6. 补跑受影响区域的 typecheck、lint、build 和测试。

## 17. 测试要求

### 17.1 领域测试

- 创建 Federation 全局 Organization；
- 创建 City Organization，并从 Token 写入 City；
- 拒绝 City 不匹配的读取和治理；
- 全局 Organization 可从不同 City Token 访问；
- 非成员不能读取 Organization 详情；
- Owner/Admin/Member 权限矩阵完整；
- Membership 移除后不能通过 `membership/get`；
- 重新加入生成新的 `membership_id`；
- Owner 转移原子更新角色和 quota；
- 归档不可恢复并释放 quota；
- 并发创建不能突破 Owner 额度。

### 17.2 API 测试

- 15 个保留 Action 的鉴权、输入和响应；
- 已删除 Action 返回 404；
- Body 中伪造 `user_id` 或 `city_id` 不影响服务端身份；
- archived Organization 拒绝治理写入；
- `my` 正确处理全局、当前 City、其他 City 和 archived 记录。

### 17.3 数据库测试

- SQLite；
- PostgreSQL；
- Cloudflare D1；
- 三种 Runtime 维持相同事务结果和约束错误语义。

### 17.4 安全测试

- Organizations Service 不执行任何用户可控 URL 请求；
- API 响应不包含产品后端地址；
- API 响应和日志不包含 `user_token`；
- 非成员无法通过错误响应枚举 City Organization；
- Bureau 示例拒绝错误 issuer、签名、audience、过期时间和 City。

## 18. 验收标准

完成实现时必须满足：

1. Organization 数据模型不包含 `server_url`；
2. Organizations Service 不保存 Product/Bureau/Deployment 信息；
3. Organizations Service 不签发 `organization_token`；
4. Organizations Service 不向外部服务器投递撤权事件；
5. Organization 明确支持 Federation 和 City 两种作用域；
6. City Organization 的 `city_id` 只来自已验证 Token；
7. 全局 Organization 的 Membership 可以跨 City 使用；
8. Bureau 直接验证 `user_token` 并查询 Membership；
9. 产品资源权限完全由 Bureau 管理；
10. SQLite、PostgreSQL 和 D1 测试通过；
11. homepage 用户文档与公开 API 同步；
12. 公开能力变更通过规定的 patch、build 和提交流程。

## 19. 最终边界

重设计后的依赖关系如下：

```text
Federation Accounts
  -> 签发 user_token

Federation Organizations
  -> Organization
  -> Membership
  -> Join Request
  -> Organization Governance

City
  -> 携带 user_token 调用 Federation
  -> 携带 user_token 调用产品配置的 Bureau

Bureau / Product
  -> 验证 user_token
  -> 查询 Membership
  -> 管理 Product Tenant
  -> 管理资源、权限、部署和路由
```

Organization 保存关系。City 表达产品范围。Bureau 承载可信产品后端。三个对象各自维护自己的状态和权限。
