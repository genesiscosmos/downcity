# 异步任务调度与出站请求体统一修复设计

> 状态：待确认
>
> 适用范围：`@downcity/federation`、`@downcity/plugins`、`templates/edgefed`、`templates/localfed`、`app/cli` 的 Federation 模板生成器、homepage 文档
>
> 关联输入：`image-generation-federation-queue-prd.md`、`telegram-document-attachment-failure-prd.md`
>
> 结论：两份 PRD 描述的故障都成立；根因不在业务 payload，而在两处**边界契约缺失**：Federation 的异步调度能力被当作"可选配置"实现、出站 HTTP 层混用了两套 Web Body 实现。

---

## 1. 当前问题与根因

### 1.1 现象与代码位置对照

| 现象 | 触发动作 | 实际返回 | 代码位置 |
| --- | --- | --- | --- |
| 图像生成失败 | `image.image_create` | `502 {"error":{"message":"Federation queue adapter is not configured","type":"server_error"}}` | `packages/federation/src/federation/queue.ts:69` |
| 附件发送失败 | `chat.send` / 直接输出 `<file>` | 用户收到 `❌ Failed to send document: ... there is no document in the request`，调用方拿到 `delivery_id` | `packages/implementations/plugins/src/chat/channels/telegram/ApiClient.ts:290`、`:429` |
| `files` 字段被拒 | `chat.send` payload 带 `files` | `unrecognized_keys` | `packages/implementations/plugins/src/chat/runtime/ChatAgentActions.ts:60` |

### 1.2 根因 A：异步调度是隐式必选能力，却按可选配置实现

调用链（已核对）：

```text
ImagePlugin.image_create
  → context.city.embassy.user.ai.image_create         (ImagePlugin.ts)
    → AIService(image/create)
      → AIImageJobRuntime.create_job
          1. resolved.action(ctx)          → 上游任务创建成功
          2. insert_image_job(ctx, ...)   → async_jobs 落库成功
          3. enqueue_image_fetch(ctx)     → ctx.queue.send(...) 抛错
```

`FederationQueue.send()` 在未注册 adapter 时抛 `Federation queue adapter is not configured`；该错误经 `imageActionError()`（`packages/federation/src/service/ai/ai-service-values.ts:131`，把非 HTTP 错误统一包成 **502**）与 `build_error_response()`（`federation-router.ts:375`）后，输出与 PRD 记录完全一致。`models` 走 catalog、不经过队列，因此正常。

由此暴露三个真实缺陷：

1. **副作用先于能力校验**：上游任务与 `async_jobs` 记录都已产生，入队才失败。调用方拿不到 `job_id`，该任务在 DB 中保持非终态，直到 2 小时 pending 超时（`AIImageJobRuntime.ts:48`、`:192`）才被标记 failed。
2. **保护是死代码**：`if (!ctx.queue) return;`（`AIImageJobRuntime.ts:215`、`AISettlementRuntime.ts:290`）不会生效——`federation-init.ts:172` 给每个 service 注入 `_queue`，`federation-router.ts:218` 原样放进 `ctx.queue`。实际语义是"有队列就发，发不出去就抛"。
3. **模板能力不齐**：adapter 注册与消费端只存在于 `CloudflareWorkersTemplate.ts:133` 与 `:181`；`templates/localfed`、`templates/edgefed` 既无 adapter 也无 consumer。用这两个模板起的 Federation，图像生成与结算重试在结构上不可能成功，且没有任何启动期提示。

### 1.3 根因 B：出站层混用两套 Web Body 实现

commit `5c9d59b19` 把 Telegram 的裸 `fetch` 迁移到 `plugin_http_fetch`，后者使用 **npm 包 `undici` 的 fetch**（`packages/implementations/plugins/src/http/PluginHttp.ts:13`、`:151`），但调用方构造 body 用的是 **Node 全局 `FormData` / `Blob`**（`ApiClient.ts:429`、`FeishuPlatformMessaging.ts:85`）。

两者类身份不同，npm undici 的 fetch 无法识别全局 `FormData`，把 body 降级为字符串。本地实验（Node v22.23.2）：

| 组合 | 实际发出的请求 |
| --- | --- |
| Node 全局 `fetch` + 全局 `FormData` | `multipart/form-data; boundary=----formdata-undici-...`，含 `document` 字段 ✅ |
| npm `undici@7.24.8` / `7.29.0` + 全局 `FormData` | `text/plain;charset=UTF-8`，body = `[object FormData]` ❌ |
| Node 全局 `fetch` + 全局 `FormData` + npm undici `ProxyAgent` 作为 dispatcher | 正确 multipart，且代理侧收到 `CONNECT` ✅ |

Telegram 收到没有 `document` 字段的纯文本请求，返回 `400 Bad Request: there is no document in the request`；`ApiClient.ts:290` 的 catch 分支把它转成 `❌ Failed to send document: ...` 发给用户，与 PRD 记录逐字一致。

连带影响：

- **飞书同样故障**：`FeishuPlatformMessaging.ts:85-95` 是同一组合，文件与图片上传必然失败。
- **测试缺口**：`packages/implementations/plugins/scripts/plugin-http.test.mjs` 只覆盖代理、超时、脱敏，没有 multipart 用例，因此这次回归没被拦住。

### 1.4 根因 C：失败语义被降级

| 缺陷 | 位置 | 后果 |
| --- | --- | --- |
| 附件失败被吞成用户可见文本，不重新抛出 | `ApiClient.ts:290-303` | `sendMessage` 正常返回 → outbox 记为 `delivery_completed` → 发起方永远认为成功 |
| `chat.send` 入队即返回 `delivery_id`，无回执通道 | `ChatAgentActions.ts:56-79`、`ChatRuntime.ts:164-191` | 失败只写 `chat_outbox` 与 activity，Agent 无法感知 |
| outbox 的 attachment 操作类型从未实现 | `ChatRuntime.ts:767-772`（`throw new Error("Unsupported Chat delivery operation: attachment")`） | 附件只能"搭" text 顺带发，没有独立的可靠附件投递路径 |

---

## 2. 必须保持的不变量

1. **副作用可见**：任何已经产生副作用的调用，必须向调用方返回一个后续可续查的句柄（如 `job_id`），不允许"做了事却不给凭证"。
2. **能力缺失必须前置失败**：系统级能力（调度器、存储、凭据）缺失时，必须在产生副作用之前失败，而不是之后抛 502。
3. **出站层必须原样传递 body**：调用方构造的 `FormData` / `Blob` / `URLSearchParams` 必须被正确编码传输，出站层不得改变 body 语义。
4. **失败必须回到发起方**：投递失败必须出现在发起方可以读到的地方（返回值或可查询回执），不能被降级为聊天文本。
5. **事实源唯一**：`async_jobs` / `chat_outbox` 是恢复依据，队列只是触发器；触发器丢失不得导致任务无法恢复。
6. **运行期能力可探测**：能力可用性必须在启动期或 `health()` 中暴露，而不是靠第一次调用失败来发现。

---

## 3. 目标心智模型

| 对象 | 一句话职责 |
| --- | --- |
| `FederationQueue` | Federation 的异步调度能力：**默认可用**（进程内触发），**可替换**（`use` 外部队列），**缺失时必须前置失败**。 |
| `plugin_http_fetch` | 插件唯一出站层：**body 语义透传**，代理、超时、脱敏统一在这里收口。 |
| Chat Outbox | **投递事实的唯一回执点**：成功与失败都写在这里，并由发起方可读。 |

---

## 4. 设计：Federation 异步调度

### 4.1 队列能力收敛为三态

| 状态 | 出现场景 | `send()` 行为 |
| --- | --- | --- |
| `in_process` | Node / 本地 Federation 默认 | 由内置延迟适配器在进程内调用 `queue.call()` |
| `external` | 显式 `federation.queue.use(...)`（Cloudflare Queue 等） | 交给外部队列 |
| `unavailable` | Edge 运行时且未注册外部 adapter | 不隐式降级，能力校验阶段即报错 |

判定规则：adapter 由 `queue.use()` 显式提供即 `external`；Node 运行时默认 `in_process`；Edge 运行时且无 adapter 即 `unavailable`。运行时类型从 Federation 已有的运行时信息推导，不新增 `if (isWorker)` 之类散落判断。

### 4.2 默认适配器与生命周期

- 在 `packages/federation/src/federation/queue.ts` 内新增进程内延迟适配器实现：按 `delay_ms` 用定时器把消息交回 `federation.queue.call()`，并持有未完成定时器集合。
- 生命周期闭合：`Federation` 提供（或复用）`dispose()`，关闭 adapter、清理未触发定时器；不得留下悬挂 timer。
- 不新增"队列可用性"公开 API：`send()` 在 `unavailable` 下抛出带 `code` 的明确错误，调用方通过能力校验而不是探测接口判断。

### 4.3 调度前置校验与失败语义

在 `AIImageJobRuntime.create_job()` 与 `AISettlementRuntime` 的入队路径前插入能力校验：

1. **能力不可用（系统失败）**：在调用上游与落库之前失败，返回 `503`，`code: "async_dispatch_unavailable"`，message 指出缺失项与配置位置。**不允许**先建任务再报错。
2. **能力可用但单次投递失败（瞬时系统失败）**：不吞掉已产生的事实——保留 `job` 记录，状态 `queued`，把投递错误写入 `state_json.dispatch_error`，**正常返回 `job_id`**，由 4.4 的恢复机制重试。`error.md`/日志记录投递失败。
3. 删除 `if (!ctx.queue) return;` 这类永远不会触发的保护分支，改为显式能力校验，避免"假安全"。

### 4.4 事实源驱动的恢复

- 新增最小能力：把非终态 `ai.image.generate` 任务重新入队的 reconciler（`ai/jobs/resume` 或等价入口），输入为"重新入队上限内、状态属于 queued/running/fetching"的任务集合。
- 触发点：
  - Node / 本地：`federation.health()` 完成后执行一次，随后按固定间隔执行。
  - Edge：由已配置的 cron / scheduled handler 触发（与队列 consumer 同属部署契约）。
- 该 reconciler 同时兜住"进程重启导致 in-process 定时器丢失"的场景，使不变量 5 成立。

### 4.5 模板与部署契约

| 位置 | 改动 |
| --- | --- |
| `templates/localfed` | 无需配置即获得 `in_process`，图像生成可用 |
| `templates/edgefed` | 不注册 adapter 时：`health()` 明确报告 `unavailable`，不得静默降级 |
| `CloudflareWorkersTemplate`（`app/cli` 生成器） | 保持显式 `queue.use` + `queue()` consumer，并新增缺 binding 时的启动期校验与可读错误 |
| homepage | 在 Federation / 图像能力文档中写明"图像生成与结算重试依赖异步调度能力；Cloudflare 需配置 `DOWNCITY_QUEUE`，本地由进程内调度器兜底" |

---

## 5. 设计：出站请求体

> 状态：已实现（commit `894ecfb19`，`@downcity/plugins` 1.0.313）

### 5.1 在出站边界归一化 FormData（根因修复）

根因不是 undici 缺少 multipart 能力，而是**类身份**：调用方用 Node 全局 `FormData`，出站层用 npm undici 的 fetch，两套实现的实例互不 `instanceof`，undici 因此把整个 body 当成普通对象序列化成字符串 `[object FormData]`。

实现方式：在 `plugin_http_fetch` 内识别全局 `FormData`，逐项复制到 undici `FormData`，再走原有 undici fetch 链路。

```text
body instanceof 全局 FormData
  → 逐项复制到 undici FormData（保留 filename 与分段 Content-Type）
  → undici fetch（原有代理 / 超时 / 取消 / 错误归一化链路不变）
其他 body（字符串 / Buffer / URLSearchParams / Blob）
  → 原样透传（undici 已能正确序列化）
```

选择这个方案而不是切换 fetch 实现的原因：

1. **单实现**：代理、超时、取消、脱敏全部留在原链路，不依赖 Node 全局 fetch 未文档化的 `dispatcher` 行为（原 §13 风险项随之消失）。
2. **零额外内存**：调用方本来就是 `fs.readFile` + `Blob`，文件已在内存，逐项复制不新增文件读取。
3. **改动最小**：已验证 `plugins/src` 内无裸 `fetch(`，`new FormData()` 仅 Telegram / 飞书两处，都经此边界。

实测证据（Node v22.23.2）：

| 组合 | 实际发出的请求 |
| --- | --- |
| npm undici fetch + 全局 `FormData`（修复前） | `text/plain`，body = `[object FormData]` ❌ |
| npm undici fetch + 全局 `Blob` 作为 body | 正确按 `text/markdown` 发送 ✅ |
| npm undici `FormData` + 全局 `Blob`/`File` | 正确 multipart，文件名与分段类型保留 ✅ |
| 归一化后经 `ProxyAgent` | 正确 multipart，且代理侧收到 `CONNECT` ✅ |
| 全局 `Headers` 交给 undici fetch | 正常，同样问题不存在 ✅ |

### 5.2 为什么不自行伪造 undici 的 File

npm undici 只导出 `FormData`，**不导出 `Blob` / `File`**（`typeof u.File === "undefined"`）。但 5.1 的实验表明它**接受全局 `Blob`/`File` 实例**并正确序列化，因此不需要手动读取流或伪造文件对象——那才是我最初担心多余复杂度的地方。

### 5.3 回归测试

`plugin-http.test.mjs` 新增 3 个 multipart 用例（本地 HTTP Server，不依赖外网）：

- 断言 `content-type` 为 `multipart/form-data; boundary=...`，且 body 不含 `[object FormData]`；
- 断言 body 同时包含普通字段与文件字段的 `Content-Disposition`、文件名与分段 `Content-Type`；
- 断言配置代理后仍走代理隧道（复用现有假代理手法）；
- 断言非 `FormData` 请求体（JSON 字符串、`URLSearchParams`）序列化语义不变。

---

## 6. 设计：投递回执

> 状态：6.1 与 6.2 前半已实现（commit `f2321b50e`，`plugins` 1.0.314）。6.2 的 `chat.delivery` 与 6.3 属 P1-5。

### 6.1 附件失败必须上抛

`TelegramApiClient.sendMessage()` 的附件分支去掉"只发 ❌ 文本"的吞错路径：附件发送失败即抛出，由 outbox 记录失败并进入既有重试/失败状态；是否附带错误提示消息由上层策略决定，不允许由底层改写投递结果。Feishu 附件路径同样收敛到"失败即抛出"。

实测确认：outbox 管道本来就是完好的——`sendToolText` 会把异常收敛为 `success: false`，`ChatRuntime.kick_outbox` 已在 `!result.success` 时抛错并调用 `fail_outbound`。故障仅在于**被喂了假的成功**：旧代码把附件失败改写成 ❌ 文本后正常返回，于是 `sendToolText` 返回 `success: true`，outbox 被标记为 `delivered`。因此修复点只在信道层源头。

### 6.2 `chat.send` 的回执契约

- `chat.send` / `chat.react` 保持"可靠入队"语义，返回受理回执，明确它不是送达回执。
- `status` 取自真实 Outbox 记录的初始状态（`pending`），不硬编码、不另造一套词汇表。类型为 `ChatDeliveryAcceptance`，定义在 `chat/types/ChatReliability.ts`。
- 新增最小查询入口 `chat.delivery`（输入 `delivery_id`，输出 `status`/`attempt_count`/`last_error`），供 Agent 在需要确认时读取真实结果。**属 P1-5，尚未实现。**
- 保持不新增 `files` 字段：附件表达方式唯一化为正文 `<file>` 标签（见 6.3），并为不支持的入参提供可读提示，替换 `unrecognized_keys` 这类框架级信息。

### 6.3 明确附件表达方式

- 文档与 `PROMPT.direct` 明确：唯一受支持的附件表达是正文中的 `<file type="..." caption="...">path</file>`；`files` 等结构化字段不在契约内。
- `ChatRuntime` 的 `Unsupported Chat delivery operation: attachment` 分支不再作为运行时兜底存在：要么补齐该操作类型，要么在写入侧（store）拒绝，二者只能取一。**本期选择后者**（见第 11 节），保证不再出现"契约里没有、运行时会炸"的中间状态。

---

## 6A. 回归测试（P0-2）

新增 `scripts/chat-delivery.test.mjs`（`pnpm test:chat-delivery`），只桩网络层、保留真实路径解析与错误传播：

- 附件 multipart 上传返回 Telegram 真实 400 时，`sendMessage` 必须 reject；断言 **没有任何 ❌ 文本被发出**（修复前正是这一点造成 outbox 静默成功）；
- 附件路径不存在时给出可读的 `Attachment not found`，而不是被网络错误掩盖；
- 纯文本发送不受影响；
- `chat.send` / `chat.react` 返回值包含真实 `status`。

已反向验证测试有拦截力：回退 `ApiClient.ts` 后前两个用例以 `Missing expected rejection` 失败，即旧代码下 `sendMessage` 正常返回。

---

## 7. 职责与依赖变化

| 文件 | 变化 | 依赖方向 |
| --- | --- | --- |
| `packages/federation/src/federation/queue.ts` | 新增进程内适配器、能力三态、带 code 的错误 | 不变（Federation 内部） |
| `packages/federation/src/service/ai/AIImageJobRuntime.ts` | 前置能力校验；投递失败保留事实；接入 reconciler | Service → Federation 能力，方向不变 |
| `packages/federation/src/service/ai/AISettlementRuntime.ts` | 同上（结算重试） | 不变 |
| `packages/implementations/plugins/src/http/PluginHttp.ts` | 出站边界归一化全局 `FormData` | Plugin → 出站层，方向不变 |
| `packages/implementations/plugins/src/chat/channels/telegram/ApiClient.ts` | 附件失败上抛 | 不变 |
| `packages/implementations/plugins/src/chat/channels/feishu/Feishu.ts` | 附件失败上抛 | 不变 |
| `packages/implementations/plugins/src/chat/types/ChatReliability.ts` | 新增 `ChatDeliveryAcceptance` 类型 | 不变 |
| `packages/implementations/plugins/src/chat/runtime/ChatAgentActions.ts` | 返回体增加 `status`；新增 `chat.delivery`（P1-5） | 不变 |
| `packages/implementations/plugins/src/chat/runtime/ChatRuntime.ts` | 两个 Agent 发送入口改为返回受理回执 | 不变 |
| `templates/*`、`app/cli/.../CloudflareWorkersTemplate.ts` | 调度能力装配与启动期校验 | 部署层 → SDK，方向不变 |
| `homepage/content/**` | 能力与部署文档 | 不变 |

---

## 8. 新增、修改与删除的公开能力

| 类型 | 内容 |
| --- | --- |
| 新增 | `chat.delivery` plugin action |
| 修改 | `FederationQueue.send()` 错误改为带 `code`、语义改为"能力决定"；`chat.send` 返回体新增 `status` |
| 删除 | `AIImageJobRuntime` / `AISettlementRuntime` 中永不生效的 `!ctx.queue` 分支；`ApiClient` 的吞错降级路径 |
| 不引入 | 不新增"队列可用性探测"公开 API（能力校验已在服务侧完成）；不新增 `files` 字段；不引入运行时 flag 开关 |

---

## 9. 数据与失败语义

| 场景 | 分类 | 处理 | 事实源状态 |
| --- | --- | --- | --- |
| 调度能力缺失 | 系统失败 | 前置 `503 + code`，不产生副作用 | 无写入 |
| 单次投递失败 | 瞬时系统失败 | 返回 `job_id`；记录 `dispatch_error`；由 reconciler 重试 | `async_jobs.status = queued` |
| 上游生成失败 | 业务失败 | 既有 `failed` 结果与原错误返回 | `async_jobs.status = failed` |
| 附件上传失败 | 系统失败 | 抛出，outbox 记 `failed` + `last_error` | `chat_outbox.status = failed` |
| 附件路径不存在 | 业务失败 | 抛出可读错误，不重试到耗尽 | `chat_outbox.status = failed` |

---

## 10. 测试与验证范围

| 层级 | 用例 |
| --- | --- |
| `@downcity/plugins` | multipart 回归（5.3）；附件失败必须上抛且不发 ❌ 文本；纯文本不受影响；`chat.send` / `chat.react` 返回含 `status`。`chat.delivery` 用例待 P1-5 |
| `@downcity/federation` | 无外部 adapter 时 Node 下 `queue.send` 成功（in_process）；投递失败时 `create_job` 仍返回 `job_id` 且 `dispatch_error` 已写入；reconciler 能把非终态任务重新入队；能力缺失时前置失败且无副作用 |
| templates | localfed 端到端图像生成；edgefed 缺 binding 时 `health()` 报错 |
| 验证顺序 | 定向 typecheck → 定向测试 → 消费 package typecheck → patch build（`@downcity/federation`、`@downcity/plugins`）→ homepage build（文档变化时） |

无法在当前系统验证的部分：Telegram / 飞书真实上传与 Cloudflare Queue 行为必须由对应环境验证，本机只能验证到"请求体编码正确"与"能力装配正确"。

---

## 11. 明确不做

- 不新增模型、不改 ImagePlugin 的模型清单与 prompt 构造。
- 不实现 outbox 的 `attachment` 独立操作类型（本期改为在写入侧拒绝，保持"唯一附件表达方式"）。
- 不引入队列可用性探测 API、不新增布尔开关。
- 不改 Telegram / 飞书 Bot 权限与账号配置。
- 不为旧行为保留双路径（按仓库规范直接迭代）。

---

## 12. 实施顺序

1. ✅ **P0-1 出站体修复**：`PluginHttp` 归一化全局 `FormData` + multipart 回归测试（commit `894ecfb19`，`plugins` 1.0.313）。一次改动同时修好 Telegram、飞书、Web。
2. ✅ **P0-2 失败语义**：Telegram / 飞书附件失败上抛；`chat.send` / `chat.react` 返回受理回执（含 `status`）（commit `f2321b50e`，`plugins` 1.0.314）。
3. **P1-1 调度能力**：进程内适配器 + 能力三态 + `Federation.dispose()` 清理。
4. **P1-2 服务侧校验**：`AIImageJobRuntime` / `AISettlementRuntime` 前置校验、投递失败保留事实、删除死分支。
5. **P1-3 恢复**：reconciler 与触发点。
6. **P1-4 模板与文档**：localfed / edgefed / Cloudflare 生成器、homepage 文档。
7. **P1-5 回执**：`chat.delivery` 查询入口与 `ChatRuntime` 的 attachment 分支收口。

---

## 13. 风险与待确认

1. ~~**Node 全局 fetch 的 dispatcher 依赖**~~：已消失。最终方案保留 undici fetch 单实现，不依赖 Node 全局 fetch 的未文档化 `dispatcher` 行为。
2. **进程内适配器的定时器语义**：Node 单实例可靠，但进程退出会丢失定时器，因此 4.4 的 reconciler 是必需项而非增强项。
3. **Cloudflare 部署侧**：目标是确认现有部署是否缺少 `DOWNCITY_QUEUE` 生产者与 consumer；若缺失，需要部署侧配合补 binding，SDK 侧只保证"缺了就明确报错"。
4. **`chat.delivery` 的边界**：仅允许查询当前 Agent 拥有 Session 的 delivery，沿用 `ChatAgentActions` 现有的所有权校验。
5. **附件重试的重复文本**：Outbox 按整条 delivery 重试，一条消息内若"文本段已发、附件段失败"，重试会重发文本段。这是既有结构（无分段级进度）的固有限制，本期不改；修复后至少失败可见且可恢复，优于原先的静默成功。
