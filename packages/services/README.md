# @downcity/services

Downcity 官方服务聚合包。

这个包统一提供账号、Credits Cards、usage、统一 Payment 与多支付 provider 等官方服务。

## 安装

```bash
pnpm add @downcity/services
```

## 使用

```ts
import {
  AccountsService,
  CreditsService,
  PaymentService,
  OrganizationsService,
  UsageService,
  creemPaymentProvider,
  dodoPaymentProvider,
  emailAccountsProvider,
  githubAccountsProvider,
  googleAccountsProvider,
  stripePaymentProvider,
  wechatAccountsProvider,
  waffoPaymentProvider,
} from "@downcity/services";
```

Federation 可以安装通用 Organization 服务：

```ts
const federation = new Federation({ database });

federation.use(new OrganizationsService({
  max_organizations_per_user: 3,
}));
```

Organization 可以使用 Federation 全局作用域，也可以限定在当前 Token City。Service
只管理 Organization、Membership、Join Request 和治理角色，不保存产品后端地址。
City 使用当前 `user_token` 调用产品配置的可信 Bureau，Bureau 再向 Federation 查询
Membership 并执行自己的产品资源权限。Organizations Service 支持 SQLite、PostgreSQL
与 Cloudflare D1，三种数据库统一使用 `context.transaction()`。

产品侧通常先这样读取支付方式：

```ts
const methods = await guest.service("payment").get("methods");
```

再根据返回结果调用具体支付方式，例如：

```ts
const checkout = await user.service("payment").action("checkout/create").invoke({
  method_id: "stripe",
  topup_amount_minor: 500,
  idempotency_key: "order_123",
});
```

Creem 支付方式使用同样的调用形态：

```ts
const checkout = await user.service("payment").action("checkout/create").invoke({
  method_id: "creem",
  topup_amount_minor: 500,
  idempotency_key: "order_123",
});
```

## 包含的服务

- `AccountsService`：统一账号服务容器，负责账号表、better-auth、profile、OAuth callback 和 `user_token` 签发
- `emailAccountsProvider()` / `githubAccountsProvider()` / `googleAccountsProvider()` / `wechatAccountsProvider()`：作为 provider 挂到统一 `AccountsService`
- `CreditsService`：永久 Primary Card、限时 Ephemeral Card、Transaction 与不可变 Entries
- `PaymentService`：拥有支付订单并统一暴露支付方式、checkout、webhook 与 payments；paid 后通过 `on_paid` 接入 Credits
- `UsageService`：通过 `AIService` 与 `CreditsService` Reader 聚合当前用户的每日 Credits 消费和 AI 技术用量
- `OrganizationsService`：管理 Federation 全局或 City 作用域的 Organization、Membership、加入申请与治理角色
- `stripePaymentProvider()` / `creemPaymentProvider()` / `dodoPaymentProvider()` / `waffoPaymentProvider()`：作为 provider 挂到统一 `PaymentService`

`AccountsService` 启用只代表账号服务、表和 better-auth runtime 已安装；具体登录方式由 provider 决定。`/v1/accounts/providers` 只返回 required env 或 runtime 配置已经满足的 provider。产品侧统一使用 `accounts.login/start`、`accounts.login/continue`、`accounts.login/result`：OAuth 返回授权 URL，input provider 先提交输入，最终都从 `login/result` 读取 `user_token`。
