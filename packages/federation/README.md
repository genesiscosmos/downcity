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

Federation 继续负责账户、Token、Admin Session、Service、BureauRecord、可信业务路由、discovery 和 JWKS。现有 HTTP endpoint、数据库结构和 Token claim 不因 package 迁移而变化。
