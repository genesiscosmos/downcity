/**
 * Cloudflare Workers Federation 内置模板。
 *
 * 模板声明 D1、Queue 和可选 R2，由 `fed deploy` 的 Cloudflare 内置部署器准备资源。
 */

import type {
  FederationTemplateFile,
  FederationTemplateInput,
} from "@/federation/types/FederationTemplate.js";

/** 创建 Cloudflare Workers 模板文件。 */
export function create_cloudflare_workers_template_files(
  input: FederationTemplateInput,
): FederationTemplateFile[] {
  const package_name = normalize_package_name(input.name);
  return [
    {
      path: "federation.json",
      content: json_file({
        schema: 1,
        type: "federation",
        id: input.fed_id,
        name: input.name,
        entry: "src/index.ts",
        deployment: {
          target: "cloudflare-workers",
          resources: {
            d1: { type: "d1", binding: "DB", name: `${input.name}-db` },
            queue: { type: "queue", binding: "DOWNCITY_QUEUE", name: `${input.name}-queue` },
            storage: {
              type: "r2",
              binding: "DOWNCITY_STORAGE",
              name: `${input.name}-storage`,
              public_url_prefix: "",
            },
          },
        },
      }),
    },
    {
      path: "package.json",
      content: json_file({
        name: package_name,
        version: "0.0.1",
        private: true,
        type: "module",
        scripts: {
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@downcity/city": "latest",
          "@downcity/database-d1": "latest",
          "@downcity/services": "latest",
        },
        devDependencies: {
          "@cloudflare/workers-types": "latest",
          typescript: "latest",
          wrangler: "latest",
        },
      }),
    },
    {
      path: "tsconfig.json",
      content: json_file({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ["@cloudflare/workers-types"],
        },
        include: ["src/**/*.ts"],
      }),
    },
    {
      path: ".gitignore",
      content: ["node_modules/", ".env", ".wrangler/", ""].join("\n"),
    },
    {
      path: "src/index.ts",
      content: create_worker_entrypoint(),
    },
  ];
}

/** 创建 Cloudflare Worker 入口。 */
function create_worker_entrypoint(): string {
  return `/**
 * Cloudflare Workers Federation entry.
 *
 * 关键说明（中文）
 * - D1、Queue 与 R2 binding 由 fed deploy 根据 federation.json 生成。
 * - Federation 实例在 Worker isolate 内复用，第一次请求时完成初始化。
 */

import {
  AIService,
  Federation,
  R2Storage,
  type CityQueueMessage,
  type FederationAdminProvisioning,
} from "@downcity/city";
import { Database } from "@downcity/database-d1";
import {
  AccountsService,
  CreditsService,
  UsageService,
  githubAccountsProvider,
  googleAccountsProvider,
  wechatAccountsProvider,
} from "@downcity/services";

export interface Env {
  /** Federation D1 数据库。 */
  DB: D1Database;
  /** Federation 默认 R2 存储。 */
  DOWNCITY_STORAGE: R2Bucket;
  /** Federation 异步任务 Queue。 */
  DOWNCITY_QUEUE: Queue<CityQueueMessage>;
  /** R2 文件公开 URL 前缀。 */
  DOWNCITY_STORAGE_PUBLIC_URL_PREFIX?: string;
  /** 可信部署器注入的管理员 provisioning 模式。 */
  DOWNCITY_FEDERATION_ADMIN_PROVISION_MODE?: string;
  /** 管理员 provisioning 幂等 ID。 */
  DOWNCITY_FEDERATION_ADMIN_PROVISION_ID?: string;
  /** 初始化或恢复后的管理员 ID。 */
  DOWNCITY_FEDERATION_ADMIN_ID?: string;
  /** 管理员密码的 PBKDF2 编码摘要。 */
  DOWNCITY_FEDERATION_ADMIN_PASSWORD_HASH?: string;
}

let federation_promise: Promise<Federation> | undefined;

/** 创建并初始化当前 Worker isolate 使用的 Federation。 */
async function create_federation(env: Env): Promise<Federation> {
  const database = new Database({ binding: env.DB });
  const federation = new Federation({
    database,
    admin_provisioning: read_admin_provisioning(env),
  });
  federation.queue.use({
    send: (message) => env.DOWNCITY_QUEUE.send(message, message.delay_ms
      ? { delaySeconds: Math.ceil(message.delay_ms / 1000) }
      : undefined),
  });
  const public_url_prefix = env.DOWNCITY_STORAGE_PUBLIC_URL_PREFIX?.trim();
  if (public_url_prefix) {
    federation.storage(R2Storage({
      bucket: env.DOWNCITY_STORAGE,
      public_url_prefix,
    }));
  }
  const accounts_service = new AccountsService({
    providers: [
      githubAccountsProvider(),
      googleAccountsProvider(),
      wechatAccountsProvider(),
    ],
  });
  federation.use(accounts_service);
  const credits_service = new CreditsService();
  const ai_service = new AIService({ credits: credits_service });
  federation.use(credits_service);
  federation.use(ai_service);
  federation.use(new UsageService({
    ai_usage_reader: ai_service,
    credits_usage_reader: credits_service,
    account_usage_reader: accounts_service,
  }));
  await federation.health();
  return federation;
}

/** 读取仅由 fed deploy 注入的无明文管理员 provisioning。 */
function read_admin_provisioning(env: Env): FederationAdminProvisioning | undefined {
  const mode = env.DOWNCITY_FEDERATION_ADMIN_PROVISION_MODE?.trim();
  const provision_id = env.DOWNCITY_FEDERATION_ADMIN_PROVISION_ID?.trim();
  const admin_id = env.DOWNCITY_FEDERATION_ADMIN_ID?.trim();
  const password_hash = env.DOWNCITY_FEDERATION_ADMIN_PASSWORD_HASH?.trim();
  if (!mode && !provision_id && !admin_id && !password_hash) return undefined;
  if ((mode !== "initialize" && mode !== "reset") || !provision_id || !admin_id || !password_hash) {
    throw new Error("Incomplete Federation administrator provisioning environment.");
  }
  return { mode, provision_id, admin_id, password_hash };
}

/** 读取当前 Worker isolate 的 Federation。 */
function get_federation(env: Env): Promise<Federation> {
  federation_promise ??= create_federation(env);
  return federation_promise;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const federation = await get_federation(env);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(await federation.health());
    }
    return federation.fetch(request);
  },
  async queue(batch: MessageBatch<CityQueueMessage>, env: Env): Promise<void> {
    const federation = await get_federation(env);
    for (const message of batch.messages) {
      try {
        await federation.queue.call(message.body);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
`;
}

/** 生成带末尾换行的 JSON 文件。 */
function json_file(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 将用户名称规范化为 npm package name。 */
function normalize_package_name(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-") || "federation";
}
