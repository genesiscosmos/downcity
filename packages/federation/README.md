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

const federation = new Federation({
  database,
  services,
});
~~~

Federation 负责账户、Token、Admin Session、Service、BureauRecord、可信业务路由、discovery 和 JWKS。

## Action 请求体

普通 POST Action 默认 `body: "json"`：空体或纯空白解析为 `{}`，非空体必须是 JSON 对象。无效 JSON 返回 `400 INVALID_JSON`；数组、`null`、字符串、数字和布尔值返回 `400 INVALID_INPUT`；请求体读取失败返回 `400 INVALID_BODY`。GET Action 从 query 读取参数。

`service.action(name, handler, options?)` 的 `options.body` 可选，取值为 `"json" | "raw"`。Installable Service 的 `ctx.route({ ..., body, handler })` 同样支持该选项，仅适用于 Action 路由。需要原文验签的 webhook Action 显式声明 `body: "raw"`：普通 Action Context 的 `raw_body` 与 Installable Action 的 `ctx.text()` 保留原始文本；后者调用 `ctx.json()` 时仍严格要求 JSON 对象，空体或纯空白返回 `{}`。

`handler: { request }` 原生路由直接接收 Request，不预读取或解析请求体；OAuth 的 form、回调和 redirect 按各自原生协议处理。

## HTTP 请求 ID 与错误

每个进入 Federation Router 的 HTTP 请求由服务端生成 `req_<UUID>`，忽略调用者提供的请求 ID。所有响应均覆盖 `x-request-id`，包括成功、错误、native Response、流式响应和路由 404。Action `Context.request_id` 与 `Context.locals.request_id` 可读，AI relay 的 `request_id` 与该 ID 一致。Router 之外由宿主直接处理的响应不属于此范围。

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
| 409 | `conflict_error` | `CONFLICT` |
| 413 | `invalid_request_error` | `BODY_TOO_LARGE` |
| 429 | `rate_limit_error` | `RATE_LIMITED` |
| 其他 4xx | `invalid_request_error` | `REQUEST_REJECTED` |
| 503 | `server_error` | `SERVICE_UNAVAILABLE` |
| 504 | `server_error` | `REQUEST_TIMEOUT` |
| 其他 5xx | `server_error` | `INTERNAL_ERROR` |

明确的 4xx `httpError` 保留 message。所有 5xx（包括保留领域码的错误）与未知 Error 都不暴露原始 message：503 为 `Service temporarily unavailable`，504 为 `Request timed out`，其他 5xx 为 `Internal server error`。

业务或 native handler 直接返回的错误 `Response` 由业务负责正文，框架不归一化正文，但仍覆盖 `x-request-id`。添加响应头不消费 body、不缓冲 SSE；流开始后的错误按流协议处理，不能改写为另一个 HTTP 状态或 JSON 错误。`onError` hook 自身失败不会覆盖原始错误。

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
