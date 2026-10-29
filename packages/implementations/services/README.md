# @downcity/services

Downcity 官方服务聚合包。

这个包统一提供账号、Credits Cards、usage、统一 Payment 与多支付 provider 等官方服务。

Accounts、Credits、Payment、Feedback 与 Organizations 通过 `database_schemas` 支持 SQLite/D1 和 PostgreSQL。数据库适配器需要提供 `schema_id`，并将每次 `atomic()` 的全部命令按顺序绑定到同一个物理事务连接。PostgreSQL 的认证集成使用 better-auth `pg` provider。

PostgreSQL 部署必须执行 Federation `prepare_database()`：Accounts 显式建立邮箱、Session Token、Provider 身份唯一索引和查询索引；Credits 显式建立 CHECK 约束与账务索引。历史数据违反约束时准备失败，不自动删除或合并数据。

认证日期从 SQLite 毫秒整数迁移到 PostgreSQL `timestamptz`，需要显式按 epoch milliseconds 转换；Credits 流水新增 PostgreSQL `ledger_sequence`，导入时按原 SQLite `rowid` 升序插入，由数据库生成该列。迁移字段与验证结果见 [PostgreSQL 适配交付记录](./POSTGRESQL-ADAPTATION.md)。

当前 PostgreSQL Credits 原子写使用服务级事务 advisory lock，确保跨 Card 总额与补偿记账的串行语义。它会串行化不同用户的账务写入，属于扩容前需要收敛到用户级锁的吞吐限制。

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

Payment 的 `paid` 与 wallet 履约状态独立；自由充值发放 Primary Card，套餐沿用下单时冻结的权益及稳定履约时间。`on_paid(record, fulfillment)` 应使用稳定 `payment_id` 幂等处理。所有 `paid` 事件必须提供已验签的可信金额、币种及外部交易标识，金额和币种须匹配本地订单快照，不能以请求 metadata 代替实付证明；缺失、无效或不匹配时以 422 阻止发放并将 inbox 事件转入 `review`。

- Stripe：本金取 `amount_subtotal - total_details.amount_discount`，必须满足 `amount_total = 本金 + amount_tax + amount_shipping`，独立税费与运费不购买 Credits；含税或混合口径无法确认时进入 `review`。
- Creem：读取已验签的 `order.amount_paid`，不存在时取 `order.amount`，币种取 `order.currency`，与订单严格匹配。
- Waffo：将已验签的 `orderAmount` 按 `orderCurrency` 精度精确转换为整数最小单位，不使用浮点四舍五入。
- Dodo：读取已验签的 `total_amount`、`currency`；创建 checkout 前强制一次性 `pay_what_you_want`、同币种、无折扣/PPP、`tax_inclusive: true`，且产品最低价不高于订单金额。当前严格要求税含定价，异常进入 `review`。

这些规则不提供通用税费、折扣或换汇自动核算；无法确认金额口径的交易须人工核对。

Webhook 验签、规范化后先持久化 inbox，再入队，成功返回 HTTP 200 只代表接收。Queue 执行 `events/process`；宿主须周期调用 `payment.recover_events()` 或管理员 `POST /v1/payment/events/recover`，恢复到期 pending 与过期 processing。当前 Edge 每五分钟扫描，部署计划由 `federation.json` 的 `deployment.crons` 声明。临时失败从 15 秒指数退避至最多一小时，20 次后进入 `review`；金额校验失败（422）直接进入 `review`。管理员通过 `GET /v1/payment/events/inbox` 查看诊断，使用 `POST /v1/payment/events/replay` 携带 `{ "event_id": "provider:event_id" }` 重放；重放仍执行校验与幂等履约。

## 包含的服务

- `AccountsService`：统一账号服务容器，负责账号表、better-auth、profile、OAuth callback 和 `user_token` 签发
- `emailAccountsProvider()` / `githubAccountsProvider()` / `googleAccountsProvider()` / `wechatAccountsProvider()`：作为 provider 挂到统一 `AccountsService`
- `CreditsService`：永久 Primary Card、限时 Ephemeral Card、Transaction 与不可变 Entries
- `PaymentService`：拥有支付订单、wallet 权益快照和独立履约状态，统一暴露支付方式、checkout、webhook 与 payments；通过 `on_paid(record, fulfillment)` 幂等接入 Credits
- `UsageService`：通过 `AIService` 与 `CreditsService` Reader 聚合当前用户的每日 Credits 消费和 AI 技术用量
- `OrganizationsService`：管理 Federation 全局或 City 作用域的 Organization、Membership、加入申请与治理角色
- `stripePaymentProvider()` / `creemPaymentProvider()` / `dodoPaymentProvider()` / `waffoPaymentProvider()`：作为 provider 挂到统一 `PaymentService`

`AccountsService` 启用只代表账号服务、表和 better-auth runtime 已安装；具体登录方式由 provider 决定。`/v1/accounts/providers` 只返回 required env 或 runtime 配置已经满足的 provider。产品侧使用 `POST /v1/accounts/login/start`，显式指定 `client_type`，保存返回的 `login_id` 与仅供发起端保管的 `login_secret`。OAuth 返回授权 URL，input provider 通过 `POST login/continue` 提交输入及领取凭据。`POST login/result` 携带 `login_id`、`login_secret`，只返回状态；完成后通过 `POST login/exchange` 携带相同凭据与稳定的随机 `exchange_id` 领取 `user_token`。网络失败重试必须复用原 `exchange_id`。不要将 `login_secret` 放入 URL、页面或日志。

`web` 登录要求同源请求及发起浏览器 Cookie；`cli`、`desktop` 和 `device` OAuth 登录还需在原始客户端展示 `user_code`，由用户输入授权确认页。Email 登录要求邮箱验证，OAuth 身份不会按相同邮箱静默合并。

`await embassy.user.account.logout()` 先撤销当前 User Token，再清理本地凭证；撤销失败保留凭证以便重试。Bureau 对新的受保护请求向 Federation 在线检查 Token，有效性检查不可用时拒绝访问；已开始的流式请求不会被强制中断。
