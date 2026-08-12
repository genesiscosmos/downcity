# Federation、Embassy 与 Bureau 身份架构

## 1. 设计目标

本文定义 Downcity Federation 包中的三个核心概念及其身份边界：

- Federation 是远程权威服务。
- Embassy 是人类用户或管理员访问 Federation 的客户端入口。
- Bureau 是产品业务分区；`Bureau` 客户端是该产品后端使用的机器身份入口。

本次迁移只整理概念归属和公开 API，不改变既有业务能力：账户仍然登录、管理员仍然管理 Federation、产品后端仍然可以识别用户、已有 Service 仍由 Federation 执行。

City 和 Agent 属于 Agent 运行环境，不在本文和 `@downcity/federation` 的领域范围内。

## 2. 核心不变量

1. Federation 是所有 Token 的唯一签发权威。
2. Embassy 只有 `user` 和 `admin` 两个身份子域。
3. Admin Session 只负责授权管理操作，不是长期业务服务凭证。
4. Bureau Token 是某个 Bureau 后端的长期机器凭证，由 Federation 生成。
5. Bureau Token 不能签发 User Token。
6. `Bureau` 与 `Embassy` 完全解耦，二者不互相持有。
7. User Token 绑定 `bureau_id`，Bureau 后端只能接受签给自己的 User Token。
8. Federation 数据库不保存 Bureau Token 明文，只保存 hash；明文仅在签发响应中返回一次。

## 3. 概念与身位

### 3.1 Federation

Federation 是系统的远程权威和服务运行容器，拥有：

- 管理员账号、密码摘要和 Admin Session。
- 用户账户、登录状态和用户资料。
- Bureau Record、Bureau Server Record 和 Bureau Token 注册表。
- User Token 与 Bureau Token 的签发、验证和撤销规则。
- Ed25519 Key Ring、discovery 和 JWKS。
- AI、Payment、Credits、Usage 等可安装 Service。

Federation 不代表某个产品，也不运行 Agent。它可以同时服务多个 Bureau。

### 3.2 Embassy

Embassy 是访问 Federation 的客户端门面。它表达“某个自然人身份通过 Federation 办事”，只公开两个身份子域：

- `embassy.user`：用户登录、当前用户、AI、Payment 和 Service 调用。
- `embassy.admin`：管理员登录、当前管理员和 Federation 控制面。

Embassy 只接收 Federation 连接与身份恢复信息，不保存 `bureau_id`。产品分区属于具体的用户登录请求；登录完成后，业务请求从 Federation 签发的 User Token 读取 `bureau_id`。

Embassy 不接收 Bureau Token，也不提供 `identify()`。

### 3.3 Bureau

Bureau 是 Federation 中稳定的产品或业务分区，通过 `bureau_id` 标识。Bureau Record 保存：

- 产品身份和展示名称。
- active、paused、archived 生命周期状态。
- 可信业务服务 `server_url`。
- 创建、更新时间和归档时间。

`Bureau` 类是产品后端的客户端。它只接收 `federation_url` 和 `bureau_token`，公开：

- `me()`：向 Federation 验证机器凭证并读取其 Bureau 身份。
- `identify(request | user_token)`：用 Federation JWKS 本地验证 User Token，并检查 `bureau_id`。
- `user(request | user_token)`：在已验证身份上创建最小用户会话，以读取允许的 Federation 用户数据。

`Bureau` 不包含管理员能力，不签发任何 Token，也不承载产品业务实现。

## 4. 凭证模型

| 凭证 | 持有者 | 签发或创建方 | 生命周期 | 权限 |
| --- | --- | --- | --- | --- |
| 管理员密码 | 管理员 | 部署恢复流程写入摘要 | 人工轮换 | 换取 Admin Session |
| Admin Session Token | Embassy Admin | Federation | 短期、可撤销 | Federation 控制面 |
| Bureau Token | 产品后端 | Federation，经 Admin Session 授权 | 长期、可撤销 | Bureau 机器身份、`me()` |
| User Token | 用户客户端 | Federation | 短期 | 访问指定 Bureau 范围内的用户能力 |

不存在 Root Admin Token。管理员密码遗失时，由拥有基础设施权限的人运行 `fed deploy --admin-reset`。

### 4.1 Bureau Token

Bureau Token 使用以下 wire 格式：

```text
fb_<token_id>.<secret>
```

签发流程：

1. 管理员通过 Embassy 登录 Federation，获得短期 Admin Session。
2. 管理员提交 `bureau_id` 和 `purpose`。
3. Federation 验证 Bureau 存在且未归档。
4. Federation 使用 Web Crypto 生成 `token_id`、随机 secret 和完整明文。
5. Federation 计算完整明文的 SHA-256 hash，只持久化 hash 和元数据。
6. 完整明文仅在本次响应中返回。
7. 产品后端把明文作为 `DOWNCITY_BUREAU_TOKEN` 安全保存。

List 接口只返回 Token 元数据，不返回明文或 hash。撤销后，同一 Token 的 `me()` 和依赖机器身份的 `identify()` 必须立即失败。

### 4.2 User Token

User Token 是 Federation 使用 Ed25519 私钥签发的 JWT，外层使用 `ub_` 前缀。核心 claim 包括：

- `sub` / `user_id`：用户身份。
- `bureau_id`：Token 可访问的产品分区。
- `iss`：Federation issuer。
- `aud`：统一 User Token audience。
- `exp`、`iat`、`jti`：生命周期和唯一标识。
- `metadata`：可选业务元数据。

User Token 可以由账户登录流程产生，也可以由已授权的 Federation Admin 管理接口产生。无论入口是哪一个，实际签名和签发都发生在 Federation 内部。

Bureau Token 对 Accounts `/tokens/issue` 没有权限。它不能代理 Admin，也不能把自己的长期机器身份升级为用户签发权。

## 5. 公开 API

### 5.1 用户 Embassy

```ts
import { Embassy } from "@downcity/federation";

const embassy = new Embassy({
  federation_url: "https://fed.example.com",
});

const providers = await embassy.user.account.providers();

await embassy.user.account.login({
  provider: "email",
  bureau_id: "product-web",
  input: {
    email: "user@example.com",
    password: "password",
  },
});

const current_user = await embassy.user.current();
const user_token = embassy.user.account.token();
```

账户 API 保持为：

- `embassy.user.account.providers()`
- `embassy.user.account.login()`
- `embassy.user.account.continue()`
- `embassy.user.account.status()`
- `embassy.user.account.token()`
- `embassy.user.account.logout()`

### 5.2 管理员 Embassy

```ts
const embassy = new Embassy({
  federation_url: "https://fed.example.com",
});

await embassy.admin.login({
  admin_id: "owner",
  password: "password",
});

const current_admin = await embassy.admin.current();
const bureaus = await embassy.admin.bureaus.list();
```

管理员通过同一上下文管理 Bureau 和 Bureau Token：

```ts
const issued = await embassy.admin.bureaus.tokens.issue({
  bureau_id: "product-web",
  purpose: "production backend",
});

const tokens = await embassy.admin.bureaus.tokens.list("product-web");
await embassy.admin.bureaus.tokens.revoke(issued.token_id);
```

`issue()` 表示管理员授权 Federation 签发，不表示 Embassy 本地生成 Token。

### 5.3 Bureau 后端

```ts
import { Bureau } from "@downcity/federation";

const bureau = new Bureau({
  federation_url: "https://fed.example.com",
  bureau_token: process.env.DOWNCITY_BUREAU_TOKEN!,
});

const machine = await bureau.me();
const identity = await bureau.identify(request);
const current_user = await bureau.user(request);
const profile = await current_user.profile();
```

业务请求中的 User Token 由用户登录 Federation 获得。Bureau 只验证和消费该 Token。

## 6. 请求流程

### 6.1 用户登录

```text
User App
  -> Embassy User
  -> Federation Accounts
  -> 账户认证
  -> Federation 签发 User Token(bureau_id)
  -> Embassy User 保存 Token
```

### 6.2 Bureau Token 签发

```text
Administrator
  -> Embassy Admin 登录
  -> Admin Session
  -> embassy.admin.bureaus.tokens.issue(...)
  -> Federation 生成明文并保存 hash
  -> 明文只返回一次
  -> Bureau 部署环境安全保存
```

### 6.3 Bureau 识别用户

```text
User App 携带 User Token
  -> Bureau 后端
  -> Bureau.me() 验证 Bureau Token
  -> 获取 Federation discovery / JWKS
  -> 本地验证签名、issuer、audience、有效期
  -> 校验 User Token.bureau_id == Bureau.bureau_id
  -> 返回 BureauIdentity
```

`identify()` 不调用远程 Accounts identify 接口。每次识别前在线验证 Bureau Token，保证撤销对长期运行的 Bureau 实例立即生效；User Token 的签名校验仍在本地完成。JWKS 可以短期缓存，未知 `kid` 时强制刷新一次。

## 7. server_url 的语义

`server_url` 是某个 Bureau 的可信产品后端 origin，作用只有两个：

1. Embassy User 发起 Bureau 业务请求时解析目标地址。
2. 防止 User Token 被转发到与当前 Bureau 无关的 origin。

它不是 Federation 地址，不是 Bureau Token 的签发服务，也不要求 Bureau 后端实现通用 Downcity Server。Federation 和 Bureau 后端可以部署在不同机器、网络和运行时。

## 8. 存储与安全边界

Federation 数据库存储：

- Bureau Record 和 Bureau Server Record。
- Bureau Token 的 `token_id`、`bureau_id`、`purpose`、hash、状态和时间戳。
- User Token 的签名密钥材料及必要的撤销状态。
- 管理员密码摘要和 Admin Session。

Federation 数据库不存储：

- Bureau Token 明文。
- 管理员明文密码。
- 产品后端自己的业务数据。

部署环境负责安全保存 Bureau Token 明文。泄露时必须撤销旧 Token并签发新 Token；不能通过 list 接口找回旧明文。

## 9. 包边界

- `@downcity/federation`：正式拥有 Federation、Embassy、Bureau、Service 和协议类型。
- `@downcity/city`：拥有 Agent 宿主、多 Agent 集合、本地持久化装配与 HTTP/RPC transport。
- `downcity` CLI：管理本机 Agent/City，并通过 `fed` 命令管理 Federation 部署和凭证。
- Agent package：拥有单 Agent、Workspace、Session 和 Plugin SDK，不依赖本文的身份客户端组织方式。

依赖方向是客户端和 Service 依赖 Federation 的最小公开 API；Federation 不依赖 CLI、Desktop、City 或 Agent。

## 10. CLI

```bash
fed bureau token
fed bureau token issue <bureau_id>
fed bureau token list
fed bureau token revoke <token_id>
```

CLI 必须先取得有效 Admin Session，然后调用 Federation。CLI 不在本地生成 Bureau Token，也不把 Admin Session 当作 Bureau Token。

签发成功后输出：

```bash
DOWNCITY_BUREAU_TOKEN=fb_br_xxx.secret
```

## 11. HTTP 权限

| Endpoint | 身份 | 说明 |
| --- | --- | --- |
| `POST /v1/admin/login` | 公开登录入口 | 验证管理员 ID 和密码 |
| `POST /v1/bureaus/tokens/issue` | admin | Federation 签发 Bureau Token |
| `GET /v1/bureaus/tokens/list` | admin | 列出 Token 元数据 |
| `POST /v1/bureaus/tokens/revoke` | admin | 撤销 Bureau Token |
| `GET /v1/bureaus/me` | bureau | 读取当前机器身份 |
| `POST /v1/accounts/tokens/issue` | admin | Federation 管理员授权签发 User Token |
| `GET /v1/accounts/me` | user | 读取当前用户资料 |

关键拒绝规则：

- 无凭证签发 Bureau Token：401。
- Bureau Token 调用管理员接口：403。
- Bureau Token 调用 Accounts User Token 签发接口：403。
- 已撤销 Bureau Token 调用 `me()`：401。
- Bureau 验证其他 `bureau_id` 的 User Token：401。
- Embassy 构造参数传入 Bureau Token：类型错误。

## 12. 数据迁移与命名

数据库继续使用 `federation_bureau_tokens` 表和 `token_id`、`token_hash` 字段。凭证格式继续使用 `fb_` 前缀。这里的 Token 是不透明机器凭证，不表示 JWT。

公开概念迁移：

| 迁移前调用方式 | 正式调用方式 |
| --- | --- |
| City 用户客户端 | `embassy.user` |
| FederationAdmin | `embassy.admin` |
| 管理员与业务身份混合对象 | `EmbassyAdmin` 与独立 `Bureau` |
| 客户端本地登记机器凭证 | Federation `tokens.issue()` |
| 业务服务验证用户 | `bureau.identify()` |

不保留两套凭证命名或双轨 API。新代码只使用 `bureau_token`、`BureauTokenRecord`、`BureauTokenSummary`、`IssueBureauTokenInput` 和 `DOWNCITY_BUREAU_TOKEN`。

## 13. 非目标

本次不处理：

- City 和 Agent 的运行生命周期。
- Desktop 如何实例化 Agent。
- Bureau 自身产品业务的代码组织。
- 跨 Federation 的身份互信。
- Bureau Token 自动轮换协议。
- User Token 权限模型的进一步细分。

## 14. 验收标准

1. Embassy 构造参数不包含 Bureau Token。
2. Embassy Admin 不公开 `identify()`。
3. `Bureau` 可从 package 根入口直接导入。
4. Bureau 只公开 `me()`、`identify()` 和 `user()` 身份能力。
5. Bureau Token 只由 Federation 生成，签发结果只返回一次明文。
6. Token list 和数据库都不暴露 Bureau Token 明文。
7. Accounts User Token 签发 endpoint 仍只接受 admin。
8. 测试明确覆盖 Bureau Token 签发 User Token 返回 403。
9. CLI、README 和 Homepage 统一使用 `fed bureau token` 与 `DOWNCITY_BUREAU_TOKEN`。
10. Federation、Services 和 CLI 的类型检查与测试通过。
