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
~~~

Key 管理使用登录身份；调用 Key 不获得通用 user 权限，明文只在签发时返回。消费额度按已完成结算检查，是允许并发在途超出的 Credits 软上限，不预占资金。渠道配置只持有凭据环境变量引用。日志不保存正文或凭据。

第一批仅在同一公开模型的部署间切换；最新媒体若需要另一模型，调用者需显式选择。明确认证/限流拒绝可有限切换，网络异常、5xx、超时和流中断不透明重试。未提供 RPM/TPM、全局并发租约、Responses、Messages 或管理网页。

完整接口与配置语义见 [模型中转与 API Key](https://downcity.ai/zh/city-sdk-docs/service/ai/relay)。
