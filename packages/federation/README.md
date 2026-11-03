# @downcity/federation

@downcity/federation 提供 Downcity Federation 服务端运行时、Embassy 客户端和 Bureau 业务服务客户端。

## 安装

~~~bash
pnpm add @downcity/federation
~~~

## Embassy

~~~ts
import { Embassy } from "@downcity/federation";

const embassy = new Embassy({
  federation_url: "https://fed.example.com",
});

const providers = await embassy.user.account.providers();
~~~

Embassy 只有两个身份子域：

- embassy.user：用户登录、AI、Payment、Service 和 Bureau 业务请求。
- embassy.admin：管理员 Session 和 Federation 管理。

用户登录成功后，当前 Embassy 实例会立即使用新 User Token：

~~~ts
await embassy.user.account.login({
  provider: "email",
  bureau_id: "product-web",
  input: {
    email: "user@example.com",
    password: "password",
  },
});

const current_user = await embassy.user.current();
~~~

管理员使用用户名和密码获得有期限的 Admin Session：

~~~ts
await embassy.admin.login({
  admin_id: "owner",
  password: "password",
});

const bureaus = await embassy.admin.bureaus.list();
~~~

Admin Session 可以授权 Federation 签发长期 Bureau Token。Token 明文由 Federation 生成且只返回一次，数据库只保存 hash：

~~~ts
const issued = await embassy.admin.bureaus.tokens.issue({
  bureau_id: "product-web",
  purpose: "production backend",
});
~~~

业务服务使用独立的 Bureau 客户端消费该 Token：

~~~ts
import { Bureau } from "@downcity/federation";

const bureau = new Bureau({
  federation_url: "https://fed.example.com",
  bureau_token: process.env.DOWNCITY_BUREAU_TOKEN!,
});

const machine = await bureau.me();
const identity = await bureau.identify(request);
const user = await bureau.user(request);
~~~

`Bureau` 与 `Embassy` 完全解耦。Bureau Token 只能证明业务服务机器身份、读取自身注册信息和本地验证 Federation User Token，不能签发 User Token。User Token 的签发权威始终是 Federation。

## Federation

~~~ts
import { Federation } from "@downcity/federation";

const fed = new Federation({
  database,
  http: {
    ordinary: {
      max_body_bytes: 1_048_576,
      body_timeout_ms: 15_000,
      execution_timeout_ms: 30_000,
    },
    routes: [
      { path: "/v1/reports/import", max_body_bytes: 4_194_304 },
    ],
  },
});
~~~

Federation 负责账户、Token、Admin Session、Service、BureauRecord、可信业务路由、discovery 和 JWKS。

## HTTP 边界与期限

`Federation.fetch()` 默认在 middleware 和 Router 之前启用 HTTP 边界，有界读取原始正文后再进入业务。`FederationOptions.http` 可部分覆盖 `ordinary`、`webhook`、`media`、`model_stream` 的 `max_body_bytes`、`body_timeout_ms`、`execution_timeout_ms`；省略字段使用所属类别的默认值。

| 类别 | 精确路径 | 正文上限 | 正文读取总期限 | 执行期限 / 等待响应头 |
| --- | --- | --- | --- | --- |
| `ordinary` | 其他路径，包括 `/v1/ai/image/result` | 1 MiB（1,048,576 bytes） | 15 s | 30 s |
| `webhook` | `/v1/payment/webhook` | 2 MiB（2,097,152 bytes） | 15 s | 30 s |
| `model_stream` | `/v1/ai/stream` | 40 MiB（41,943,040 bytes） | 60 s | 180 s |
| `media` | `/v1/chat/completions`、`/v1/ai/chat/completions` 及 `/v1/ai/` 下的 `image/create`、`asr`、`tts`、`embedding`、`rerank`、`video`、`audio`、`decision` | 40 MiB（41,943,040 bytes） | 60 s | 180 s |

`http.routes` 为 `[{ path, max_body_bytes?, body_timeout_ms?, execution_timeout_ms? }]`，按完整 pathname 精确匹配并优先于类别配置，未提供的限额继承该路径所属类别。不接受前缀、通配符、查询串、片段或重复路径。限额必须为正安全整数；正文上限最多 256 MiB，毫秒期限最多 2,147,483,647；未知字段或无效值在构造时拒绝。

正文按每个实际 `Uint8Array` chunk 的 `byteLength` 累计；无 `Content-Length` 或伪造较小长度都不能绕过上限。声明长度超限可提前拒绝；无效长度返回 `400 INVALID_CONTENT_LENGTH`。`Content-Encoding` 只能省略或为 `identity`，其他编码返回 `415 UNSUPPORTED_CONTENT_ENCODING`。正文读取总期限不因收到新 chunk 而延长。正文超时返回 `408 REQUEST_BODY_TIMEOUT`，超限返回 `413 BODY_TOO_LARGE`，读取失败返回 `400 INVALID_BODY`。

执行期限从请求正文读完开始，涵盖 middleware 和业务处理。非 SSE 的 timer 持续到响应正文读完或取消才释放；响应头发送前到期返回 `504 REQUEST_TIMEOUT`，响应头已发送后只结束流，不改 HTTP 状态。无正文的 OPTIONS 请求也使用普通执行期限。模型及媒体入口默认等待响应头最多 180 秒，这不代表首有效输出期限。收到 SSE `Response` 后，timer 切换为 `http.stream_lifetime_ms` 总期限，默认 `900_000`（15 分钟），仍从请求正文读完起算，包含等待响应头的时间；边界不缓冲 SSE。期限或取消会 abort 下游并取消 reader、结束流，不构造通用 SSE 错误帧。目前未实现首有效输出 120 秒或 idle 120 秒策略。

客户端取消对应 `499 REQUEST_CANCELLED`；连接断开后不能保证客户端收到响应。`ServiceRouteContext.abort_signal` 和 Action `Context.abort_signal` 可读，原生 Request 使用 `request.signal`。Adapter 应合并请求信号与自身 deadline；上游较短期限仍会先到期。取消为协作式中断，数据库操作可能继续执行，不表示事务撤销，也不触发自动重试。已入队的图片 task 独立执行，不继承前台创建或结果查询请求的取消。

Edge / local-node 通过 workspace 链接 SDK，开发构建会使用该默认策略。生产部署需构建包含该功能的 SDK 和服务产物；运行实例不会因源码或文档更新而自动更新。

## Action 请求体

普通 POST Action 默认 `body: "json"`：空体或纯空白解析为 `{}`，非空体必须是 JSON 对象。无效 JSON 返回 `400 INVALID_JSON`；数组、`null`、字符串、数字和布尔值返回 `400 INVALID_INPUT`；请求体读取失败返回 `400 INVALID_BODY`。GET Action 从 query 读取参数。

`service.action(name, handler, options?)` 的 `options.body` 可选，取值为 `"json" | "raw"`。Installable Service 的 `ctx.route({ ..., body, handler })` 同样支持该选项，仅适用于 Action 路由。需要原文验签的 webhook Action 显式声明 `body: "raw"`：普通 Action Context 的 `raw_body` 与 Installable Action 的 `ctx.text()` 保留原始文本；后者调用 `ctx.json()` 时仍严格要求 JSON 对象，空体或纯空白返回 `{}`。

`handler: { request }` 原生路由的正文同样由 HTTP 边界有界读取一次，再按原始字节重建 Request，不进行 Action JSON 解析；OAuth 的 form、回调和 redirect 按各自原生协议处理。

## HTTP 请求 ID 与错误

每个进入 `Federation.fetch()` HTTP 边界的请求，在 middleware 前由服务端生成 `req_<UUID>`，忽略调用者提供的请求 ID。普通 HTTP 协议范围内的边界响应覆盖 `x-request-id`，包括 middleware 短路、413、408、504、成功、业务错误、native Response、流式响应和路由 404。Router、Action `Context.request_id`、`Context.locals.request_id` 与 AI relay 使用相同 ID。宿主在 Federation HTTP 边界之外直接处理的响应不属于此范围；HTTP 101 upgrade 不重新包装或托管，也不保证 `x-request-id` 响应头。

框架捕获的抛错统一返回：

~~~json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "INVALID_JSON: Request body must be valid JSON",
    "type": "invalid_request_error",
    "request_id": "req_550e8400-e29b-41d4-a716-446655440000"
  }
}
~~~

仅当错误显式携带整数 `statusCode`（400–599），且 `code` 匹配 `^[A-Za-z][A-Za-z0-9_]{0,63}$` 时保留领域码，包括 `503 async_dispatch_unavailable`。合法状态码配合缺失或不合法的 code 时使用下表默认码；缺失或无效的 `statusCode` 一律返回 `500 INTERNAL_ERROR`，即使错误带有 code。

| HTTP 状态 | type | 默认 code |
| --- | --- | --- |
| 400 | `invalid_request_error` | `INVALID_REQUEST` |
| 401 | `authentication_error` | `UNAUTHENTICATED` |
| 403 | `permission_error` | `FORBIDDEN` |
| 404 | `not_found_error` | `NOT_FOUND` |
| 408 | `invalid_request_error` | `REQUEST_BODY_TIMEOUT` |
| 409 | `conflict_error` | `CONFLICT` |
| 413 | `invalid_request_error` | `BODY_TOO_LARGE` |
| 415 | `invalid_request_error` | `UNSUPPORTED_CONTENT_ENCODING` |
| 429 | `rate_limit_error` | `RATE_LIMITED` |
| 499 | `request_cancelled_error` | `REQUEST_CANCELLED` |
| 其他 4xx | `invalid_request_error` | `REQUEST_REJECTED` |
| 503 | `server_error` | `SERVICE_UNAVAILABLE` |
| 504 | `server_error` | `REQUEST_TIMEOUT` |
| 其他 5xx | `server_error` | `INTERNAL_ERROR` |

明确的 4xx `httpError` 保留 message。所有 5xx（包括保留领域码的错误）与未知 Error 都不暴露原始 message：503 为 `Service temporarily unavailable`，504 为 `Request timed out`，其他 5xx 为 `Internal server error`。

业务或 native handler 直接返回的错误 `Response` 由业务负责正文，框架不归一化正文，但仍覆盖 `x-request-id`。添加响应头不消费 body、不缓冲 SSE；流开始后的边界超时或取消会 abort 下游并取消 reader，不能改写为另一个 HTTP 状态或 JSON 错误，也不生成通用 SSE 错误帧。`onError` hook 自身失败不会覆盖原始错误。

框架 5xx 结构日志仅包含 `event`、`request_id`、`status`、`code`，不记录正文、Token、原始 Error 或 stack。这不代表完整 access log，也不保留原始堆栈。

接口细节见 [HTTP API](https://downcity.ai/zh/city-sdk-docs/reference/http-api) 与 [Service 与 Action](https://downcity.ai/zh/city-sdk-docs/packages/federation/service-and-action)。

## 模型中转

`new AIService({ relay: true, credits }).use(models)` 启用持久化模型、渠道、部署和 route 配置、独立 API Key、`priority_weighted` 路由、共享健康冷却及请求/尝试日志。标准 `GET /v1/models`、`POST /v1/chat/completions` 与原生模型流复用 AIService 和可靠结算。

~~~ts
const issued = await embassy.user.relay.create_key({
  name: "Editor",
  allowed_models: ["deepseek-v4-flash"],
  spend_limit: 10000,
  expires_at: null,
});
const requests = await embassy.user.relay.list_requests({ limit: 50 });
const snapshot = await embassy.admin.relay.catalog();
const metadata = await embassy.admin.relay.metadata(); // 已安装模板与适配器，不含凭据
const health = await embassy.admin.relay.health(); // 共享冷却快照，不执行模型探测
~~~

Key 管理使用登录身份；调用 Key 不获得通用 user 权限，明文只在签发时返回。消费额度按已完成结算检查，是允许并发在途超出的 Credits 软上限，不预占资金。渠道配置只持有凭据环境变量引用。日志不保存正文或凭据。

第一批仅在同一公开模型的部署间切换；最新媒体若需要另一模型，调用者需显式选择。明确认证/限流拒绝可有限切换，网络异常、5xx、超时和流中断不透明重试。Fedman 提供模型、渠道、部署与 route 管理，revision 冲突须刷新后重新编辑，引用阻止删除。未提供 RPM/TPM、全局并发租约、Responses 或 Messages。

完整接口与配置语义见 [模型中转与 API Key](https://downcity.ai/zh/city-sdk-docs/service/ai/relay)。
