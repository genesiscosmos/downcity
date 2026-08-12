# @downcity/city

`@downcity/city` 是 Federation API 的迁移兼容入口。

Federation 服务端运行时、Embassy 客户端和 Bureau 领域能力已经统一归属
`@downcity/federation`。本 package 不再维护独立实现，只从
`@downcity/federation/legacy` 转发迁移前的公开导出，避免形成两套逻辑。

## 新代码

新代码直接安装并使用正式 package：

```bash
pnpm add @downcity/federation
```

```ts
import { Bureau, Embassy, Federation } from "@downcity/federation";

const embassy = new Embassy({
  federation_url: "https://fed.example.com",
  bureau_id: "product-web",
});

const providers = await embassy.user.account.providers();

const federation = new Federation({
  database,
  services,
});
```

Embassy 只公开两个身份子域：

- `embassy.user`：用户账户、AI、Payment、Service 和 Bureau 业务请求。
- `embassy.admin`：管理员 Session 和 Federation 控制面。

登录后的 Admin 可以请求 Federation 签发长期、可撤销的 Bureau Token：

```ts
const issued = await embassy.admin.bureaus.tokens.issue({
  bureau_id: "product-web",
  purpose: "production backend",
});
```

业务服务使用与 Embassy 解耦的 Bureau 客户端：

```ts
const bureau = new Bureau({
  federation_url: "https://fed.example.com",
  bureau_token: process.env.DOWNCITY_BUREAU_TOKEN!,
});

const identity = await bureau.identify(request);
```

Federation 生成 Bureau Token 明文并只返回一次，数据库只保存 hash。Bureau 无权签发
User Token；User Token 始终由 Federation 在账户登录或管理员授权流程中签发。

## 旧代码

旧导入仍由兼容层提供：

```ts
import {
  Bureau,
  City,
  Federation,
  FederationAdmin,
} from "@downcity/city";
```

这些名称只用于现有代码迁移，不代表 `@downcity/city` 仍拥有对应领域实现。
新功能不会继续添加到此兼容入口。

## 迁移关系

| 旧入口 | 正式入口 |
| --- | --- |
| `@downcity/city` | `@downcity/federation` |
| `City` 用户客户端 | `Embassy` 的 `user` 子域 |
| `FederationAdmin` | `Embassy` 的 `admin` 子域 |
| `Bureau` 身份客户端 | `Bureau` 正式客户端 |
| Bureau 机器凭证 | `bureau_token` |
| Bureau 部署环境变量 | `DOWNCITY_BUREAU_TOKEN` |

完整 API 与示例见 [`@downcity/federation`](../federation/README.md)。
