# Federation Credits Card 服务设计

## 1. 文档状态

- 状态：方案已确认，待实现
- 范围：将 `@downcity/services` 的 `BalanceService` 重构为 `CreditsService`
- 核心模型：一个永久 Primary Card + 多个限时 Ephemeral Card
- 账务模型：Credits Transaction + Transaction Entries
- 管理入口：Federation 内部实例与可信 Bureau
- 用户范围：只支持已经拥有 `user_id` 的注册账户

本阶段不包含：

- Accounts 改造与匿名主体。
- 账户之间转账。
- 首次充值奖励。
- 活动资格判断。
- 更多 Card 类型。
- Card 使用范围与模型权限。
- Card 主动关闭、延期或余额搬运。
- 自动续费与额度月包。
- 预授权与消费额度冻结。
- 银行卡、银行授信或负债能力。

## 2. 产品意图

Credits 服务用 Card 表达一组具有共同生命周期的 credits：

```text
CreditsService
  └── User
      ├── Primary Card       永久、唯一
      ├── Ephemeral Card A   有效期至某个时间
      └── Ephemeral Card B   有效期至另一个时间
```

业务方可以通过两种方式发放额度：

1. 创建一张新的 Ephemeral Card，并写入初始额度。
2. 给一张仍然有效的 Ephemeral Card 继续 Topup。

CreditsService 不判断用户为什么获得额度。新用户奖励、文档导入奖励、连续活跃奖励与创作者奖励，都只是 Bureau 或其他可信业务调用 Credits API 的原因。

用户消费时，CreditsService 统一选择 Card、判断有效期并原子扣款。调用方不自行拼接余额，也不自行修改 Card。

## 3. 核心设计结论

### 3.1 服务使用 Credits 命名

服务从 `BalanceService` 调整为 `CreditsService`，Service ID 从 `balance` 调整为 `credits`。

原因：

- `balance` 只描述当前数值，不能表达 Card、生命周期与流水。
- `credits` 是完整领域名称，可以稳定容纳 Card、Topup、Charge 与 History。
- `CreditService` 容易被理解为贷款或授信服务，因此使用复数 `CreditsService`。

目标调用形式：

```ts
const credits = new CreditsService();
federation.use(credits);

await credits.topup(...);
await credits.charge(...);
```

### 3.2 Card 类型使用独立表

Primary Card 与 Ephemeral Card 具有不同的不变量，因此分别持久化：

```text
service_credits_primary_cards
service_credits_ephemeral_cards
```

不使用通用 Cards 表加 `kind` 字段，不让 Primary Card 长期携带无意义的 `expires_at = null`、`source` 和活动字段。

只有生命周期和行为真正不同的 Card 类型才使用独立表。`welcome`、`creator_reward`、`document_import` 是 Ephemeral Card 的来源，不是新的 Card 类型，也不创建新的表。

### 3.3 Topup、Charge 与 Operation 合并为 Transaction

Topup 和 Charge 都是一次完整的 Credits 业务变动；原 Operation 的幂等、状态和原子控制与这次变动拥有同一生命周期。因此统一为：

```text
service_credits_transactions
```

Transaction 的 `kind` 区分：

```ts
/**
 * Credits 事务类型。
 */
export type CreditsTransactionKind = "topup" | "charge";
```

公开 API 仍保留 `topup()` 和 `charge()`，但两者都返回 `CreditsTransaction`。

### 3.4 Ledger 收敛为 Transaction Entries

一次 Topup 通常影响一张 Card，一次 Charge 可能影响多张 Card。Card 级变化不能合并到 Transaction 单行，也不能放进不可查询的 JSON。

原 Ledger 收敛为：

```text
service_credits_transaction_entries
```

一条 Transaction Entry 表达一次 Transaction 对一张 Card 的实际影响，同时承担不可变流水职责。

### 3.5 最终只有四张核心表

```text
service_credits_primary_cards
service_credits_ephemeral_cards
service_credits_transactions
service_credits_transaction_entries
```

不再单独创建：

- Topups 表。
- Charges 表。
- Operations 表。
- Ledger 表。
- 通用 Cards 表。

## 4. 职责边界

### 4.1 CreditsService 负责

- 确保每个用户只有一个 Primary Card。
- 创建和读取 Ephemeral Card。
- 给指定 Card Topup。
- 按固定顺序消费一张或多张 Card。
- 排除已经过期的 Ephemeral Card。
- 保证所有 Card 余额不小于零。
- 保证创建 Card、Topup 与 Charge 原子且幂等。
- 维护 Transaction 与不可变 Transaction Entries。
- 返回用户 Credits 汇总与 Card 明细。

### 4.2 CreditsService 不负责

- 判断用户是否满足奖励条件。
- 监听产品行为事件。
- 计算模型 input/output token 的价格。
- 管理支付商品、Checkout、webhook 或支付订单状态。
- 决定业务应该复用旧 Ephemeral Card 还是创建新 Card。

### 4.3 Bureau 负责

- 执行业务与运营规则。
- 验证请求中的 `user_token`。
- 创建 Ephemeral Card 或选择目标 Card。
- 根据真实模型用量计算应扣 credits。
- 使用 `bureau_token` 调用 Federation Credits 管理接口。

Bureau 不保存 Card 余额，也不直接访问 Credits 数据表。

## 5. Card 领域模型

### 5.1 Primary Card

Primary Card 是用户唯一的永久 Credits 容器：

```ts
/**
 * 用户唯一的永久 Credits Card。
 */
export interface CreditsPrimaryCard extends Record<string, unknown> {
  /**
   * Card 类型，固定为 primary。
   */
  kind: "primary";

  /**
   * Card 所属用户 ID，同时也是持久化主键。
   */
  user_id: string;

  /**
   * 当前永久额度，单位为 credits。
   */
  credits: number;

  /**
   * Card 创建时间。
   */
  created_at: string;

  /**
   * Card 最近更新时间。
   */
  updated_at: string;
}
```

Primary Card 必须满足：

- 每个 `user_id` 最多一张。
- 永不过期。
- 不能删除。
- 余额不能小于零。
- 不保存活动来源和外部业务引用。

Primary Card 在用户第一次读取 Credits、第一次 Topup 或第一次 Charge 时通过内部 `ensure_primary_card(user_id)` 创建。创建 Primary Card 不赠送额度，因此延迟创建不会改变用户权益。

公开 Card 引用使用：

```text
kind = primary
card_id = <user_id>
```

### 5.2 Ephemeral Card

Ephemeral Card 是一组具有明确到期时间的临时 Credits：

```ts
/**
 * 用户通过业务活动获得的限时 Credits Card。
 */
export interface CreditsEphemeralCard extends Record<string, unknown> {
  /**
   * Card 类型，固定为 ephemeral。
   */
  kind: "ephemeral";

  /**
   * Card 唯一 ID。
   */
  card_id: string;

  /**
   * Card 所属用户 ID。
   */
  user_id: string;

  /**
   * 面向用户和运营后台展示的名称。
   */
  name: string;

  /**
   * 当前剩余额度，单位为 credits。
   */
  credits: number;

  /**
   * Card 到期时间。
   */
  expires_at: string;

  /**
   * Card 创建来源，例如 welcome 或 creator_reward。
   */
  source: string;

  /**
   * 外部活动、任务或业务记录 ID。
   */
  ref: string;

  /**
   * Card 创建时间。
   */
  created_at: string;

  /**
   * Card 最近更新时间。
   */
  updated_at: string;

  /**
   * 根据余额和 expires_at 计算出的当前状态。
   */
  status: CreditsEphemeralCardStatus;
}
```

```ts
/**
 * Ephemeral Card 当前状态。
 */
export type CreditsEphemeralCardStatus =
  | "active"
  | "depleted"
  | "expired";
```

Ephemeral Card 必须满足：

- 创建时 `initial_credits` 必须为正安全整数。
- `expires_at` 必须晚于创建时间。
- 余额不能小于零。
- 到期后不能 Topup 或 Charge。
- 第一版不支持延长 `expires_at`。
- Card 到期不影响同一用户的其他 Card。

状态按以下顺序计算，不单独持久化：

```text
expires_at <= current_time  → expired
credits = 0                 → depleted
其他                        → active
```

### 5.3 Card 引用

Topup 或指定 Card Charge 使用明确的联合类型：

```ts
/**
 * 可被 Credits 操作定位的 Card 引用。
 */
export type CreditsCardReference =
  | {
      /**
       * Primary Card 类型。
       */
      kind: "primary";

      /**
       * Primary Card 所属用户 ID。
       */
      user_id: string;
    }
  | {
      /**
       * Ephemeral Card 类型。
       */
      kind: "ephemeral";

      /**
       * Ephemeral Card 唯一 ID。
       */
      card_id: string;
    };
```

## 6. Credits 账户视图

```ts
/**
 * 用户全部当前 Credits Card。
 */
export interface CreditsCardsView extends Record<string, unknown> {
  /**
   * 用户唯一的 Primary Card。
   */
  primary: CreditsPrimaryCard;

  /**
   * 当前有效且有余额的 Ephemeral Cards，按到期时间升序排列。
   */
  ephemeral: CreditsEphemeralCard[];
}

/**
 * 用户当前 Credits 账户视图。
 */
export interface CreditsAccount extends Record<string, unknown> {
  /**
   * 用户 ID。
   */
  user_id: string;

  /**
   * 当前总可用额度。
   */
  available_credits: number;

  /**
   * 按 Card 生命周期组织的当前额度。
   */
  cards: CreditsCardsView;
}
```

汇总关系：

```text
available_credits
  = primary_card.credits
  + SUM(未过期 ephemeral_card.credits)
```

Card 是额度的权威事实源。`available_credits` 仅在读取时由当前 Cards 推导，不持久化第二份总余额；其余按类型汇总、Card 数量和下一到期时间由调用方按展示需要计算。

用户读取示例：

```ts
const account = await city
  .service("credits")
  .get<CreditsAccount>("me");
```

## 7. Transaction 模型

### 7.1 CreditsTransaction

```ts
/**
 * 一次完整的 Credits 业务变动与幂等边界。
 */
export interface CreditsTransaction extends Record<string, unknown> {
  /**
   * Transaction 唯一 ID。
   */
  transaction_id: string;

  /**
   * Transaction 类型。
   */
  kind: CreditsTransactionKind;

  /**
   * Transaction 所属用户 ID。
   */
  user_id: string;

  /**
   * 本次变动总额度；始终为正安全整数。
   */
  credits: number;

  /**
   * Transaction 当前状态。
   */
  status: "pending" | "applied";

  /**
   * 同一种 Transaction 内的稳定幂等键。
   */
  idempotency_key: string;

  /**
   * 业务来源，例如 payment、welcome 或 model_usage。
   */
  source: string;

  /**
   * 外部支付、活动、任务或模型调用 ID。
   */
  ref: string;

  /**
   * 人类可读说明。
   */
  note: string;

  /**
   * 结构化审计信息 JSON 文本。
   */
  metadata_json: string;

  /**
   * Transaction 创建时间。
   */
  created_at: string;

  /**
   * Transaction 完成时间；pending 时为空。
   */
  applied_at: string | null;
}
```

`credits` 始终保存正数，实际方向由 `kind` 决定：

```text
topup  → +credits
charge → -credits
```

数据库对 `(kind, idempotency_key)` 建立唯一约束。同一种 Transaction 使用相同幂等键和相同标准化参数重试时返回首次结果；参数不一致时返回 `409`。

### 7.2 CreditsTransactionEntry

```ts
/**
 * 一次 Transaction 对一张 Card 的不可变额度变化。
 */
export interface CreditsTransactionEntry extends Record<string, unknown> {
  /**
   * Entry 唯一 ID。
   */
  entry_id: string;

  /**
   * 所属 Transaction ID。
   */
  transaction_id: string;

  /**
   * Card 所属用户 ID。
   */
  user_id: string;

  /**
   * 目标 Card 类型。
   */
  card_kind: "primary" | "ephemeral";

  /**
   * Primary Card 使用 user_id，Ephemeral Card 使用 card_id。
   */
  card_id: string;

  /**
   * 本条 Entry 的额度变化；Topup 为正，Charge 为负。
   */
  credits_delta: number;

  /**
   * 本条变化提交后的 Card 余额。
   */
  credits_after: number;

  /**
   * Entry 创建时间。
   */
  created_at: string;
}
```

Transaction Entry 同时承担 Ledger 职责，不再维护另一张内容重复的流水表。

必须满足：

```text
Topup:
SUM(entries.credits_delta) = transaction.credits

Charge:
SUM(entries.credits_delta) = -transaction.credits
```

## 8. 数据结构

### 8.1 Primary Cards

```text
service_credits_primary_cards
  user_id          TEXT PRIMARY KEY
  credits          INTEGER NOT NULL
  created_at       TEXT NOT NULL
  updated_at       TEXT NOT NULL

CHECK(credits >= 0)
```

### 8.2 Ephemeral Cards

```text
service_credits_ephemeral_cards
  card_id          TEXT PRIMARY KEY
  user_id          TEXT NOT NULL
  name             TEXT NOT NULL
  credits          INTEGER NOT NULL
  expires_at       TEXT NOT NULL
  source           TEXT NOT NULL
  ref              TEXT NOT NULL
  created_at       TEXT NOT NULL
  updated_at       TEXT NOT NULL

CHECK(credits >= 0)
INDEX(user_id, expires_at)
```

### 8.3 Transactions

```text
service_credits_transactions
  transaction_id   TEXT PRIMARY KEY
  kind             TEXT NOT NULL
  user_id          TEXT NOT NULL
  credits          INTEGER NOT NULL
  status           TEXT NOT NULL
  idempotency_key  TEXT NOT NULL
  request_json     TEXT NOT NULL
  source           TEXT NOT NULL
  ref              TEXT NOT NULL
  note             TEXT NOT NULL
  metadata_json    TEXT NOT NULL
  created_at       TEXT NOT NULL
  applied_at       TEXT NULL

UNIQUE(kind, idempotency_key)
CHECK(credits > 0)
CHECK(kind IN ('topup', 'charge'))
CHECK(status IN ('pending', 'applied'))
```

`request_json` 保存经过标准化的关键请求参数，用于检测相同幂等键被用于不同 Card、用户或额度。

### 8.4 Transaction Entries

```text
service_credits_transaction_entries
  entry_id          TEXT PRIMARY KEY
  transaction_id    TEXT NOT NULL
  user_id           TEXT NOT NULL
  card_kind         TEXT NOT NULL
  card_id           TEXT NOT NULL
  credits_delta     INTEGER NOT NULL
  credits_after     INTEGER NOT NULL
  created_at        TEXT NOT NULL

INDEX(transaction_id)
INDEX(user_id, created_at)
INDEX(card_kind, card_id, created_at)
CHECK(card_kind IN ('primary', 'ephemeral'))
CHECK(credits_delta != 0)
CHECK(credits_after >= 0)
```

Card 当前余额是读取热点，因此保存在 Card 表中作为物化快照；Transaction Entries 是不可变账务事实。两者必须在同一数据库事务中写入，Card 快照必须能够从 Entries 重建。

## 9. 创建 Ephemeral Card

### 9.1 输入类型

```ts
/**
 * 创建限时 Credits Card 的输入。
 */
export interface CreditsEphemeralCardCreateInput {
  /**
   * Card 所属用户 ID。
   */
  user_id: string;

  /**
   * 面向用户展示的 Card 名称。
   */
  name: string;

  /**
   * 创建时写入的正数初始额度。
   */
  initial_credits: number;

  /**
   * Card 到期时间，必须晚于当前时间。
   */
  expires_at: string;

  /**
   * Card 创建来源。
   */
  source: string;

  /**
   * 外部活动或业务记录 ID。
   */
  ref?: string;

  /**
   * 创建 Card 与初始 Topup 共用的稳定幂等键。
   */
  idempotency_key: string;

  /**
   * 面向审计的说明。
   */
  note?: string;
}
```

创建 Card 与初始 Topup 必须在同一事务完成：

1. 创建 Ephemeral Card。
2. 创建 `kind = topup` 的 pending Transaction。
3. 创建一条正数 Transaction Entry。
4. Transaction 标记为 applied。

调用示例：

```ts
const card = await bureau.credits.cards.create_ephemeral({
  user_id: "user_123",
  name: "新用户 7 天体验卡",
  initial_credits: 1_000_000,
  expires_at: "2026-08-03T00:00:00.000Z",
  source: "welcome",
  ref: "welcome_campaign_v1",
  idempotency_key: "welcome_campaign_v1:user_123",
  note: "新用户体验额度",
});
```

管理 HTTP Action：

```text
POST /v1/credits/cards/ephemeral/create
```

用户 City 不能直接创建 Ephemeral Card。

## 10. Topup

Credits 领域中的 Topup 只表示“给指定 Card 增加已经确认的 credits”，不表示创建支付订单。

### 10.1 输入类型

```ts
/**
 * 给指定 Credits Card 增加额度的输入。
 */
export interface CreditsTopupInput {
  /**
   * 接收额度的 Card。
   */
  card: CreditsCardReference;

  /**
   * 增加的额度，单位为 credits。
   */
  credits: number;

  /**
   * Topup 来源，例如 payment 或 creator_reward。
   */
  source: string;

  /**
   * 支付、活动或业务记录 ID。
   */
  ref?: string;

  /**
   * 本次 Topup 的稳定幂等键。
   */
  idempotency_key: string;

  /**
   * 面向用户与审计的说明。
   */
  note?: string;

  /**
   * 结构化审计信息。
   */
  metadata?: Record<string, unknown>;
}
```

Primary Card Topup：

```ts
const transaction = await credits.topup({
  card: {
    kind: "primary",
    user_id: "user_123",
  },
  credits: 5_000_000,
  source: "payment",
  ref: "payment_456",
  idempotency_key: "payment:payment_456",
  note: "支付到账",
});
```

Ephemeral Card Topup：

```ts
const transaction = await bureau.credits.topup({
  card: {
    kind: "ephemeral",
    card_id: "card_ephemeral_123",
  },
  credits: 100_000,
  source: "creator_reward",
  ref: "content_789",
  idempotency_key: "creator_reward:content_789",
  note: "发布内容奖励",
});
```

Topup 必须满足：

- credits 为正安全整数。
- 目标 Card 存在。
- Ephemeral Card 尚未过期。
- Topup 不修改 Ephemeral Card 的 `expires_at`。
- 一笔 Topup 只影响一张 Card，只产生一条正数 Entry。
- 幂等重试返回首次 Transaction。

管理 HTTP Action：

```text
POST /v1/credits/topups/create
```

## 11. Charge

### 11.1 输入类型

```ts
/**
 * 消费用户 Credits 的输入。
 */
export interface CreditsChargeInput {
  /**
   * 被扣费用户 ID。
   */
  user_id: string;

  /**
   * 本次消费额度，单位为 credits。
   */
  credits: number;

  /**
   * 可选指定 Card；为空时由服务自动选择 Card。
   */
  card?: CreditsCardReference;

  /**
   * 本次 Charge 的稳定幂等键。
   */
  idempotency_key: string;

  /**
   * 模型调用、任务或订单 ID。
   */
  ref?: string;

  /**
   * Charge 来源，例如 model_usage。
   */
  source: string;

  /**
   * 面向用户与审计的说明。
   */
  note?: string;

  /**
   * 模型与真实用量等结构化审计信息。
   */
  metadata?: Record<string, unknown>;
}
```

### 11.2 自动选择 Card

没有指定 `card` 时：

1. 查询未过期且余额大于零的 Ephemeral Cards。
2. 按 `expires_at` 从早到晚消费。
3. Ephemeral Cards 不足的剩余部分消费 Primary Card。
4. 总可用额度不足时整体回滚并返回 `402`。

一笔 Charge 可以产生多条负数 Transaction Entries，但只返回一条 Transaction。

### 11.3 指定 Card

指定 `card` 时：

- Card 必须属于 `user_id`。
- 只允许从指定 Card 消费。
- 指定 Card 余额不足时直接返回 `402`。
- 不自动继续消费其他 Card。

### 11.4 调用示例

```ts
const usage = await model.generate({
  prompt: "总结这篇文档",
});

const charged_credits = calculate_model_credits({
  model_id: usage.model_id,
  input_tokens: usage.input_tokens,
  output_tokens: usage.output_tokens,
});

const transaction = await credits.charge({
  user_id: "user_123",
  credits: charged_credits,
  source: "model_usage",
  ref: usage.request_id,
  idempotency_key: `model_usage:${usage.request_id}`,
  note: "AI 文档总结",
  metadata: {
    model_id: usage.model_id,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
  },
});
```

管理 HTTP Action：

```text
POST /v1/credits/charges/create
```

本阶段不增加预授权与冻结。业务方通过模型最大输出 Token 限制单次调用风险，调用完成后按 Provider 返回的真实 usage Charge。

## 12. Bureau 管理接口

`Bureau` 增加 `credits` typed invoker：

```ts
const bureau = new Bureau({
  federation_url: process.env.DOWNCITY_FEDERATION_URL!,
  bureau_token: process.env.DOWNCITY_BUREAU_TOKEN!,
});
```

目标 API：

```ts
bureau.credits.get_user(user_id);
bureau.credits.list_users(query);

bureau.credits.cards.get_primary(user_id);
bureau.credits.cards.get_ephemeral(card_id);
bureau.credits.cards.list_ephemeral(query);
bureau.credits.cards.create_ephemeral(input);

bureau.credits.topup(input);
bureau.credits.charge(input);

bureau.credits.transactions.list(query);
bureau.credits.transactions.get(transaction_id);
bureau.credits.history.list(query);
```

Card 不直接挂在 Bureau 根对象上。使用 `bureau.credits.cards` 可以保持领域归属，避免与未来其他领域的 Card 概念冲突。

Bureau Token 后续需要支持最小权限：

```text
credits:read
credits:cards:create
credits:topup
credits:charge
```

每个管理写操作由 Federation 自动记录当前 Bureau `token_id`，不能相信请求 body 自报的操作者身份。

## 13. 用户接口

第一版用户只读取自己的 Credits，不直接创建 Card 或 Topup：

```text
GET /v1/credits/me
GET /v1/credits/history/me
GET /v1/credits/transactions/me
```

读取当前账户与 Cards：

```ts
const account = await city
  .service("credits")
  .get<CreditsAccount>("me");
```

`cards.ephemeral` 只返回有效且有余额的 Card，越早过期越靠前，与自动扣费顺序一致。Primary Card 始终返回，即使余额为零。

每个用户最多拥有 100 张未过期且余额大于零的 Ephemeral Cards。已耗尽 Card 不进入当前账户视图；过期 Card 在下一次 Credits 访问时惰性删除，历史事实继续保留在 Transaction Entries 中。

## 14. PaymentService 边界

PaymentService 负责：

- 接收用户自由输入的最小货币单位金额。
- 通过服务端 `resolve_topup` 策略计算 Credits，并把金额与 Credits 固化为订单快照。
- Checkout。
- Provider webhook。
- 支付订单状态。
- 支付事件幂等。

CreditsService 负责：

- 接收已经确认的 credits 数量。
- 给目标 Primary Card Topup。
- 写入 Credits Transaction 与 Entry。

正确链路：

```text
Payment Order
  pending → paid
             ↓
      credits.topup(primary_card)
             ↓
      Credits Transaction applied
```

连接示例：

```ts
const payment = new PaymentService({
  providers: [stripe_payment_provider()],
  resolve_topup: ({ topup_amount_minor }) => ({
    credits: topup_amount_minor * 10_000,
  }),
  on_paid: async (record) => {
    await credits.topup({
      card: {
        kind: "primary",
        user_id: record.user_id,
      },
      credits: record.credits,
      source: "payment",
      ref: record.payment_id,
      idempotency_key: `payment:${record.payment_id}`,
      note: "支付到账",
    });
  },
});
```

用户创建 Checkout 时只能提交真实支付金额，不能提交 Credits 或兑换比例：

```ts
await city.payment.method("stripe").invoke({
  topup_amount_minor: 500,
  idempotency_key: "order_123",
});
```

所有 Provider 必须配置 webhook 验签密钥才可启用；缺少配置、缺少签名或签名无效时一律拒绝。Stripe 只有在 `payment_status = paid` 或收到异步支付成功事件后才能确认到账。

PaymentService 不直接修改 Card 表，CreditsService 不保存等待支付的订单，也不解析 Provider webhook。

## 15. 幂等与原子性

以下写操作必须要求 `idempotency_key`：

- 创建 Ephemeral Card 与初始 Topup。
- Topup。
- Charge。

相同 `(kind, idempotency_key)` 与相同标准化输入重复调用时返回首次 Transaction；相同幂等键用于不同参数时返回 `409`。

原子边界：

- 创建 Ephemeral Card、Topup Transaction 和 Entry 同时成功或失败。
- Topup 的 Card 快照、Transaction 和 Entry 同时成功或失败。
- Charge 涉及的全部 Card、Transaction 和 Entries 同时成功或失败。

任何部分失败都不能留下已扣款但没有 Transaction、已 Topup 但没有 Entry，或 Transaction applied 但 Card 快照未更新的中间状态。

## 16. 失败语义

| 场景 | HTTP 状态 | 行为 |
| --- | --- | --- |
| credits 不是正安全整数 | `400` | 不写入数据 |
| Card 不存在 | `404` | 不写入数据 |
| Ephemeral Card 到期时间无效 | `400` | 不创建 Card |
| 给过期 Ephemeral Card Topup | `409` | 提示创建新 Card |
| 指定 Card 不属于目标用户 | `403` | 不泄露其他用户 Card 详情 |
| 指定 Card 余额不足 | `402` | 不消费其他 Card |
| 自动 Charge 总余额不足 | `402` | 所有 Card 保持不变 |
| 幂等键参数冲突 | `409` | 返回幂等冲突 |

## 17. 旧 Balance 模型迁移

### 17.1 服务与公开 API

```text
BalanceService  → CreditsService
balance         → credits
/v1/balance/*   → /v1/credits/*
bureau.balance  → bureau.credits
```

项目规则不要求向后兼容，因此不保留长期别名或双路由。

### 17.2 账户迁移

每条旧 `service_balance_accounts` 记录迁移为一张 Primary Card：

```text
user_id     = 原 user_id
credits     = 原 credits
created_at  = 原 created_at
updated_at  = 原 updated_at
```

旧系统允许负余额，新 Credits Card 禁止负余额。迁移前必须扫描负余额账户：

- 没有负余额时才允许自动迁移。
- 存在负余额时停止迁移并输出账户列表。
- 负债处理由运营明确决定，迁移脚本不能静默归零。

### 17.3 业务记录与流水迁移

- 已支付旧 Topup 迁移为 `kind = topup` Transaction。
- 已结算旧 Charge 迁移为 `kind = charge` Transaction。
- 旧 Operation 的幂等键与状态合并进对应 Transaction。
- 旧 Ledger 迁移为 Primary Card Transaction Entries。
- pending 支付 Topup 迁移到 PaymentService 支付订单，不进入 Credits Transactions。

迁移脚本必须验证每笔 Transaction 的 Entry 汇总与 Transaction 总额一致。

### 17.4 删除的能力

- `init_credits`：删除；奖励使用 Ephemeral Card。
- `add()`：删除；入账统一使用 `topup()`。
- `sub()`：删除；消费统一使用 `charge()`。
- 普通余额透支：删除。

Redeem Code 是额度分发入口，不属于 Credits Card 内核。本阶段不扩展；后续如保留，兑换成功只能调用 `cards.create_ephemeral()` 或 `topup()`，不能直接写 Card 表。

## 18. 模块结构

```text
packages/services/src/credits/
  service.ts
  routes.ts
  schema.ts
  types/
    Card.ts
    Summary.ts
    Transaction.ts
    Topup.ts
    Charge.ts
  stores/
    primary-card-store.ts
    ephemeral-card-store.ts
    transaction-store.ts
  operations/
    create-ephemeral-card.ts
    topup-card.ts
    charge-cards.ts
```

公开类型统一放入 `types/`，每个字段提供中文文档注释。模块与关键账务节点使用中文注释。

不新增通用 Repository、事件总线、Card 策略引擎或 Service Container。

## 19. 实施顺序

1. 建立四张表与 Credits 类型。
2. 实现 Primary Card 唯一创建与 Credits 汇总。
3. 实现幂等创建 Ephemeral Card 与初始 Topup。
4. 实现指定 Card Topup。
5. 实现按到期时间自动选择 Card 的 Charge。
6. 增加 Transaction 与 History 查询。
7. 增加 Bureau `credits` typed invoker。
8. 增加用户 Credits 与 Cards 查询接口。
9. 调整 PaymentService 与 CreditsService 的入账连接。
10. 迁移旧 Balance 数据并删除旧 API。
11. 更新 CLI、Homepage 中英文文档与类型契约测试。
12. 使用多 package patch 脚本完成版本更新和构建。

实现联动 `@downcity/services`、`@downcity/city` 与支付连接，准备提交时使用：

```bash
pnpm all:patch:build
```

## 20. 验收条件

- 每个用户最多存在一张 Primary Card。
- Primary Card 永不过期且余额不能小于零。
- 一个用户可以拥有多张 Ephemeral Card。
- Ephemeral Card 必须设置未来到期时间。
- Ephemeral Card 到期时间统一保存为 UTC ISO 8601。
- 每个用户最多拥有 100 张未过期且有余额的 Ephemeral Card。
- 到期 Ephemeral Card 自动删除，不进入可用余额，也不能 Topup 或 Charge；Entries 历史继续保留。
- Bureau 可以创建 Ephemeral Card 并原子写入初始 Topup。
- Bureau 可以给仍有效的指定 Card Topup。
- 相同幂等键重试不会重复创建 Card、Topup 或 Charge。
- 自动 Charge 优先消费最早到期的 Ephemeral Card。
- Ephemeral Cards 不足时可以在同一事务继续消费 Primary Card。
- 指定 Card Charge 不会自动消费其他 Card。
- 总余额不足时所有 Card、Transaction 与 Entries 都保持不变。
- 一次跨 Card Charge 只有一条 Transaction，但可以有多条 Entries。
- Topup 和 Charge 的 Entries 汇总与 Transaction 总额方向一致。
- Card 快照、Transaction 与 Entries 在同一事务提交。
- Credits 查询可以分别展示 Primary、Ephemeral 与总可用额度。
- Payment 确认后只通过 `credits.topup()` 入账。
- 用户只提交 `topup_amount_minor`，Credits 由 Federation 服务端结算并固化到 Payment 快照。
- Provider 缺少 webhook 验签配置时不可用，未签名或错误签名事件不能入账。
- 用户全部可用 Credits 始终位于 JavaScript 安全整数范围内。
- 迁移脚本发现旧负余额或账务不一致时停止，不静默修改资产。
