# @downcity/city

`@downcity/city` 是 Downcity 的服务端运行时内核。

它负责这些共用能力：

- 挂载 `Service` / `AIService`
- 初始化内置 `cities` / `env` 表
- 校验 `user_token`、`bureau_token` 和控制面凭证
- 暴露统一的 `/v1/*` HTTP 路由
- 提供 env、数据库、hook 和鉴权上下文

## 安装

```bash
pnpm add @downcity/city
```

## 最小示例

```ts
import { Federation, AIService } from "@downcity/city";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const sqlite = new Database("./data.sqlite");
sqlite.pragma("journal_mode = WAL");

const db = Object.assign(drizzle(sqlite), {
  $client: { exec: (sql: string) => sqlite.exec(sql) },
});

const base = new Federation({ db, dialect: "sqlite", raw: sqlite });

const ai = new AIService();
ai.use({
  id: "local-echo",
  name: "Local Echo",
  actions: {
    text: async (ctx) => ({
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "text",
          text: String(ctx.input.prompt ?? ""),
          state: "done",
        },
      ],
    }),
  },
});

base.use(ai);
```

启动 HTTP 服务：

```ts
import { serve } from "@hono/node-server";

await base.health();
serve({ fetch: (request) => base.fetch(request), port: 43127, hostname: "127.0.0.1" });
```

## HTTP Middleware

Federation 级 middleware 会在内部路由和 Action body 读取之前执行。`@downcity/city` 只提供 middleware 接口，不内置 CORS、安全响应头、body 大小限制、限流、超时等策略实现；这些策略应由具体调用方按自己的 HTTP 运行环境提供。

```ts
base.middle(async (ctx, next) => {
  const origin = ctx.request.headers.get("origin");
  if (ctx.request.method === "OPTIONS" && origin === "https://app.example.com") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const response = await next();
  if (!origin) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
```

## City 说明文档

`base.instruction()` 会返回当前 Federation 实例的聚合说明文档字符串，内容包含：

- Federation 的基本使用方式
- 当前已挂载的 service
- 每个模块需要的 env 配置
- 每个模块补充的使用说明

```ts
const text = await base.instruction();
console.log(text);
```

如果你需要从远程管理端读取同一份说明，可以请求：

```txt
GET /v1/federation/instruction
```

这个接口只允许携带 Federation `admin_secret_key` 的控制面请求访问，返回 `text/plain`。

## Service

`Service` 是一组 `Action` 的容器：

```ts
import { Service } from "@downcity/city";

const notes = new Service({ id: "notes", name: "Notes" });

notes.action("create", async (ctx) => {
  return {
    ok: true,
    title: String(ctx.input.title ?? ""),
  };
});

notes.action("list", async () => {
  return { items: [] };
}, { method: "GET", auth: ["admin"] });

base.use(notes);
```

City 会自动映射为：

- `POST /v1/notes/create`
- `GET /v1/notes/list`

## AIService

`AIService` 负责模型目录和模态路由：

```ts
import {
  AIChannel,
  AIService,
  type AIChannelStreamInput,
  type LanguageModelV3StreamResult,
} from "@downcity/city";

class DeepSeekChannel extends AIChannel {
  constructor() {
    super({
      id: "deepseek",
      base_url: "https://api.deepseek.com/v1",
      env_key: "DEEPSEEK_API_KEY",
      ai_sdk_provider_id: "deepseek",
    });
  }

  protected stream(
    input: AIChannelStreamInput,
  ): Promise<LanguageModelV3StreamResult> {
    return myStreamAction(input);
  }
}

const deepseek = new DeepSeekChannel();

const ai = new AIService();
ai.use(
  deepseek.model({
    id: "deepseek-v4-flash",
    upstream_model: "deepseek-chat",
    name: "DeepSeek V4 Flash",
    context_window: 128_000,
  }),
);

base.use(ai);
```

## 官方服务

官方服务用于封装多 city 复用能力：

```ts
import { accountsService } from "@downcity/services";
import { usageService } from "@downcity/services";

base.use(accountsService());
base.use(usageService());
```

服务路由当前只支持：

- `GET`
- `POST`

## 鉴权语义

- 默认 action 需要 `user_token`
- `auth: ["admin"]` 只允许携带 Federation `admin_secret_key` 的控制面请求
- `auth: []` 表示免登录

Federation 首次启动会自动生成并持久化 Ed25519 Key Ring。私钥只用于 Federation
签发 `user_token`，公开公钥通过以下接口发布：

```text
GET /.well-known/downcity.json
GET /.well-known/jwks.json
```

用户侧 `City` 只需要 Federation 地址和登录后获得的 token：

```ts
const city = new City({
  federation_url: "https://fed.example.com",
  user_token,
});

const profile = await city.user().profile();
```

`city_id` 由 Federation 验签后从 token 中读取，客户端不再重复传入。

City 直接访问 Federation，不依赖 Bureau。只有产品需要自己的后端能力时，才通过
`fed bureau token` 打开交互式管理界面；选择创建，或直接运行
`fed bureau token create`，登记并部署 Bureau：

```bash
fed bureau token
```

创建时必须输入用途。命令生成的高熵 `bureau_token` 只显示一次，Federation 数据库保存
用途和 hash。将明文
配置到 Bureau 所在服务器：

```env
DOWNCITY_FEDERATION_URL=https://fed.example.com
DOWNCITY_BUREAU_TOKEN=fb_br_xxx.secret
```

Bureau 使用 Federation JWKS 在本地识别请求身份，并通过 `bureau_token` 调用 Federation
管理 API：

```ts
const bureau = new Bureau({
  federation_url: "https://fed.example.com",
  bureau_token,
});

const identity = await bureau.identify(request);
const profile = await (await bureau.user(request)).profile();

await bureau.cities.list();
```

City 访问 Bureau 的独立服务时，使用 JSON `get()` / `post()` 自动注入当前 `user_token`：

```ts
const city = new City({
  federation_url: "https://fed.example.com",
  user_token,
});

const result = await city.post(
  "https://bureau.example.com/reports/summary",
  { range: "today" },
);
```

`Bureau` 不绑定 `city_id`。`identify()` 返回 `user_token` 中的 `city_id`，由 Bureau 自己
决定是否允许该产品访问某个独立服务。

## 主要导出

- `City`
- `Federation`
- `Service`
- `ServiceDefinition`
- `AIService`
- `AIChannel`
- `CityModel`
- `CityModelDescriptor`
- `Bureau`
- `EnvService`
- `CitiesService`

## City 模型目录

`User City` 的 `city.ai.catalog()` 返回 `ModelCatalog`。目录中的模型是 `CityModel`，可以直接用于 City 的 AI 调用，也可以传给支持 CityModel 的 Agent SDK：

```ts
const catalog = await city.ai.catalog();
const model = catalog.get("deepseek-v4-flash");
if (!model) throw new Error("model not found");

await city.ai.text({
  model,
  prompt: "hello",
});
```

## OpenAI-compatible endpoint

如果宿主需要继续使用自己的 AI SDK provider（例如 `createOpenAICompatible()` 或
`createDeepSeek()`），直接使用 `city.ai.base_url`：

```ts
const provider = createOpenAICompatible({
  name: "downcity",
  baseURL: city.ai.base_url,
  apiKey: user_token,
});

const model = provider.languageModel("deepseek-v4-flash");
```

OpenAI-compatible 请求体只需要标准 `model/messages/stream/tools` 字段。
`city_id` 由 `user_token` 在服务端解析，不需要放进请求体。

## 文档

- 仓库首页：[downcity](https://github.com/wangenius/downcity)
- 文档目录：[homepage/content/docs](https://github.com/wangenius/downcity/tree/main/homepage/content/docs)
