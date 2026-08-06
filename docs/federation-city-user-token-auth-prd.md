# Federation、City 与 Bureau 鉴权 PRD

> 状态：已被 [`federation-bureau-city-identity-redesign.md`](./federation-bureau-city-identity-redesign.md) 取代。
>
> 本文保留为历史设计记录。其中以 `city_id` 表示产品身份、Bureau Token 不绑定产品、Bureau 拥有 Federation 管理能力等结论均已失效，不应作为实现依据。

## 1. 文档状态

- 状态：历史版本，已取代
- 范围：`@downcity/city`、Federation Accounts、CLI 与用户文档
- 核心模型：City 直连 Federation；Bureau 是可选产品后端

## 2. 目标

- Federation 是统一账户、Profile、余额和用户 Token 的事实源。
- City 是终端产品客户端，直接访问 Federation，不依赖 Bureau。
- Bureau 是 Federation 的可信服务端节点，可提供独立产品服务，也可管理 Federation。
- Federation 使用 Ed25519 私钥签发 `user_token`。
- Bureau 使用 Federation 公钥在本地验证 `user_token`。
- Bureau 只在需要当前 Federation 数据时发起在线请求。
- Bureau 使用 `bureau_token` 调用 Federation 管理 API。
- Federation 启动时不默认创建 Bureau Token。

## 3. 系统关系

```mermaid
flowchart LR
    C["City<br/>浏览器 / App"]
    B["Bureau<br/>可选产品后端"]
    F["Federation<br/>Accounts / Balance / Services"]
    P["产品自有能力"]

    C -->|"直接调用标准能力"| F
    C -->|"调用产品自有能力"| B
    B --> P
    B -->|"按需读取 Federation 数据"| F
```

City 与 Bureau 是 Federation 的两个独立调用方，不是上下游依赖关系。

## 4. 角色定义

### 4.1 Federation

Federation 负责：

- 用户注册与登录。
- Accounts 与 Profile。
- Balance、Usage、Payment。
- 使用 Ed25519 私钥签发 `user_token`。
- 发布 discovery 与 JWKS 公钥。
- 保存 Bureau 注册表。
- 为运维控制面提供独立的 admin 鉴权。

业务侧保持最简初始化：

```ts
const federation = new Federation({ database });
federation.use(new AccountsService());
```

Federation 首次启动会自动创建用户签名 Key Ring，但不会创建任何 Bureau Token。

### 4.2 City

City 是终端用户客户端：

```ts
const city = new City({
  federation_url: "https://fed.example.com",
  user_token,
});
```

City 直接访问 Federation：

```ts
const profile = await city.user().profile();
const models = await city.ai.catalog();
const methods = await city.payment.methods();
```

即使产品没有部署 Bureau，City 仍可使用 Federation 的全部标准用户能力。
需要访问 Bureau 独立服务时，City 复用当前 `user_token`：

```ts
const result = await city.post(
  "https://bureau.example.com/reports/summary",
  { range: "today" },
);
```

### 4.3 Bureau

Bureau 是可选的可信服务端节点，不绑定某一个 City：

```ts
const bureau = new Bureau({
  federation_url: "https://fed.example.com",
  bureau_token: process.env.DOWNCITY_BUREAU_TOKEN!,
});
```

Bureau 负责：

- 获取并缓存 Federation JWKS。
- 本地验证产品请求携带的 `user_token`。
- 将 `user_token.city_id` 交给独立服务执行产品授权策略。
- 执行产品自己的业务策略。
- 按需携带同一个 `user_token` 查询 Federation 当前数据。
- 使用 `bureau_token` 管理 Federation 的 City、环境、余额和 Bureau 注册表。

Bureau 不负责保存 Federation 私钥，也不通过在线 introspection 验证每个用户请求。

## 5. 凭证模型

| 凭证 | 主体 | 用途 | 是否参与用户本地验签 |
| --- | --- | --- | --- |
| `user_token` | Federation 用户 | 用户身份与 City 归属 | 是 |
| `bureau_token` | Bureau 服务端 | 调用 Federation 管理 API | 否 |
| 管理员会话 Token | `fed` 管理员 | 登录后调用 Federation 管理 API | 否 |

### 5.1 user_token

`user_token` 是 Ed25519 JWT，至少包含：

- `iss`。
- `aud = downcity:user`。
- `user_id`。
- `city_id`。
- `iat`、`exp`、`jti`。

Federation 持有私钥；Bureau 只获得公钥，因此 Bureau 能验证但不能伪造用户 Token。

### 5.2 bureau_token

Bureau Token 是高熵不透明凭证：

```text
fb_<token_id>.<secret>
```

数据库只保存完整 Token 的 SHA-256 hash，以及：

- `token_id`。
- `status`。
- 创建和更新时间。

`bureau_token` 只负责回答“这个 Bureau 是否已注册”，不用于回答“当前用户是谁”。

### 5.3 两种 Token 的实现差异

| 项目 | `user_token` | `bureau_token` |
| --- | --- | --- |
| 主体 | 终端用户 | Federation 管理端或 Bureau 服务端 |
| 格式 | `ub_<JWT>` | `fb_<token_id>.<secret>` |
| 验证方式 | Ed25519 公钥验证签名 | Federation 计算 SHA-256 后与数据库 hash 比较 |
| 是否携带用户身份 | 是，包含 `user_id`、`city_id`、`exp` 等 claims | 否，只映射到 Federation 注册表记录 |
| 是否可以本地验证 | 可以，Bureau 使用 JWKS 公钥本地验证 | 管理请求由 Federation 查询注册表 |
| 撤销方式 | 依赖过期时间和当前 Federation 状态 | 将数据库记录标记为 `revoked` |

`user_token` 的签发私钥只在 Federation 内部；Bureau 获取的是公开公钥，
因此可以验证用户 Token，但不能伪造用户 Token。

`bureau_token` 不是 JWT，也没有公钥私钥关系。它是 Bureau 与 Federation 之间的
高熵共享凭证。泄露它会允许攻击者冒充 Bureau 调用管理 API，但不能直接冒充用户。

```mermaid
flowchart LR
    FPK["Federation 私钥"] -->|"Ed25519 签名"| UT["user_token JWT"]
    JWKS["Federation JWKS 公钥"] -->|"验签"| UT
    CLI["fed bureau token create"] -->|"生成明文 + hash"| BT["bureau_token"]
    BT -->|"只提交 hash"| DB[("Federation 数据库")]
    B["Bureau"] -->|"Bearer bureau_token"| DB
```

## 6. Bureau 注册生命周期

Federation 启动后注册表为空。Bureau Token 不是 Federation 在线签发的对象，
而是由 `fed` CLI 在运维侧生成的部署凭证：

```bash
fed bureau token create
```

CLI 在本地生成明文和 hash，通过 Federation Admin 控制面登记。Federation
创建时必须输入 Token 用途。数据库只保存 `token_id`、`purpose`、`token_hash` 和生命周期状态，明文只显示一次：

```env
DOWNCITY_FEDERATION_URL=https://fed.example.com
DOWNCITY_BUREAU_TOKEN=fb_br_xxx.secret
```

CLI 也提供注册表管理：

```bash
fed bureau token
fed bureau token list
fed bureau token revoke br_xxx
```

Federation 和 Bureau 可以在不同服务器。Bureau 不调用注册接口，也不需要访问
Federation 数据库，只使用环境变量中的凭证调用 Federation 管理 API：

```ts
const bureau = new Bureau({
  federation_url: process.env.DOWNCITY_FEDERATION_URL!,
  bureau_token: process.env.DOWNCITY_BUREAU_TOKEN!,
});
```

Bureau 管理接口只接收 CLI 生成的 hash：

```ts
await bureau.bureaus.register({
  token_id,
  purpose,
  token_hash,
});
```

撤销通过 Bureau 管理面执行：

```ts
await bureau.bureaus.revoke(token_id);
```

不存在 `federation.bureaus.create()` 或 `bureau.bureaus.create()` 这类运行时签发调用。
`register/list/revoke` 只允许 root secret 或 active `bureau_token` 调用。

## 7. 用户登录与 City 调用

```mermaid
sequenceDiagram
    participant C as "City"
    participant F as "Federation"

    C->>F: "注册或登录"
    F->>F: "私钥签发 user_token"
    F-->>C: "user_token"
    C->>F: "user_token 请求 Profile / Balance / Service"
    F->>F: "验证 user_token"
    F-->>C: "用户数据"
```

City 不经过 Bureau。

## 8. Bureau 本地鉴权

首次需要验签时，Bureau 获取：

- `/.well-known/downcity.json`。
- `/.well-known/jwks.json`。

之后在缓存期内本地执行：

```ts
const identity = await bureau.identify(request);
```

验证项目：

1. Token 使用 EdDSA。
2. `kid` 存在于 Federation JWKS。
3. Ed25519 签名正确。
4. `iss` 等于可信 Federation issuer。
5. `aud` 等于 `downcity:user`。
6. Token 未过期。
7. 从 Token 读取 `city_id` 并交给 Bureau 的业务授权策略。

`identify()` 返回：

```ts
interface BureauIdentity {
  user_id: string;
  city_id: string;
  metadata: Record<string, unknown>;
  token_id: string;
  expires_at: number;
}
```

它不请求 `/accounts/identify`，也不承诺用户当前仍存在于 Accounts。

## 9. Bureau 按需读取 Federation 数据

产品只需要 JWT 身份时：

```ts
const identity = await bureau.identify(request);
```

产品需要当前 Profile 时：

```ts
const user = await bureau.user(request);
const profile = await user.profile();
```

完整流程：

```mermaid
sequenceDiagram
    participant C as "City"
    participant B as "Bureau"
    participant F as "Federation Accounts"

    C->>B: "产品请求 + user_token"
    B->>B: "公钥本地验签并执行产品策略"
    opt "需要当前 Profile"
        B->>F: "同一个 user_token 请求 /accounts/me"
        F->>F: "验证 user_token 并查询当前记录"
        F-->>B: "Profile"
    end
    B-->>C: "产品结果"
```

Federation 再次验证同一个 `user_token`，是跨服务器信任边界，不是双 Token 用户鉴权。

## 10. 用户删除与撤销语义

公钥本地验签不能立即感知用户删除，这是离线验证的固有边界。

- 普通产品操作依赖较短的 `user_token` TTL。
- Profile、余额、支付等当前状态由 Federation 在线接口返回。
- 高风险操作可以显式查询 Federation 当前状态。
- 不把所有产品请求强制改成在线 introspection。

Bureau Token 被撤销后，新的 Federation 管理请求会失败；JWKS 本身是公开信息，
撤销 Bureau Token 不会让已经签发的 `user_token` 失效。

## 11. 验收标准

- `new Federation({ database })` 不默认创建 Bureau Token。
- `fed bureau token` 是 Bureau Token 的交互式管理入口，`fed bureau token create` 是部署登记入口。
- Federation 数据库只保存 Bureau Token hash，不保存明文。
- `Bureau.bureaus.register/list/revoke()` 使用管理凭证调用控制面。
- Bureau Token 不绑定 City，也不保存 capability 列表。
- `Bureau` 暴露 City、env、余额和 Bureau 注册表管理能力。
- `Bureau.identify()` 在缓存期内不访问 Federation Accounts。
- Bureau 拒绝错误签名和过期 Token，但接受同一 Federation 下不同 City 的有效 Token。
- `City.user().profile()` 直接访问 Federation。
- `City.get(url)` / `City.post(url, body)` 自动携带当前 `user_token` 调用 Bureau 独立服务。
- `bureau.user(request).profile()` 按需访问同一 Federation Profile。
- 公共 SDK 不再导出 `FederationAdmin`。
