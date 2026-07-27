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
- `UsageService`：记录真实用户侧 service 调用事件
- `stripePaymentProvider()` / `creemPaymentProvider()` / `dodoPaymentProvider()` / `waffoPaymentProvider()`：作为 provider 挂到统一 `PaymentService`

`AccountsService` 启用只代表账号服务、表和 better-auth runtime 已安装；具体登录方式由 provider 决定。`/v1/accounts/providers` 只返回 required env 或 runtime 配置已经满足的 provider。产品侧统一使用 `accounts.login/start`、`accounts.login/continue`、`accounts.login/result`：OAuth 返回授权 URL，input provider 先提交输入，最终都从 `login/result` 读取 `user_token`。
