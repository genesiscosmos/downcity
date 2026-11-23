/**
 * Cloudflare Workers Downtown 内置模板。
 *
 * 模板声明 D1、Queue 和可选 R2，由 `fed deploy` 的 Cloudflare 内置部署器准备资源。
 */

import { stringify as stringify_toml } from "smol-toml";
import { DOWNTOWN_CONFIG_FILE_NAME } from "@/downtown/deploy/config/DowntownProjectConfigReader.js";
import type {
  DowntownTemplateFile,
  DowntownTemplateInput,
} from "@/downtown/types/DowntownTemplate.js";

/** 创建 Cloudflare Workers 模板文件。 */
export function create_cloudflare_workers_template_files(
  input: DowntownTemplateInput,
): DowntownTemplateFile[] {
  const package_name = normalize_package_name(input.name);
  return [
    {
      path: DOWNTOWN_CONFIG_FILE_NAME,
      content: stringify_toml({
        schema: 1,
        type: "downtown",
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
          "@downcity/downtown": "latest",
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
 * Cloudflare Workers Downtown entry.
 *
 * 关键说明（中文）
 * - D1、Queue 与 R2 binding 由 fed deploy 根据 downtown.toml 生成。
 * - 数据库由发布前 prepare_database 准备，Worker isolate 只装配运行时。
 */

import {
  AIService,
  Downtown,
  EnvService,
  R2Storage,
  type DowntownQueueMessage,
} from "@downcity/downtown";
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
  /** Downtown D1 数据库。 */
  DB: D1Database;
  /** Downtown 默认 R2 存储。 */
  DOWNCITY_STORAGE: R2Bucket;
  /** Downtown 异步任务 Queue。 */
  DOWNCITY_QUEUE: Queue<DowntownQueueMessage>;
  /** R2 文件公开 URL 前缀。 */
  DOWNCITY_STORAGE_PUBLIC_URL_PREFIX?: string;
}

let downtown_instance: Downtown | undefined;

/** 为请求或部署准备创建独立实例，共享相同服务声明。 */
function create_downtown(env: Env): Downtown {
  const database = new Database({ binding: env.DB });
  const downtown = new Downtown({ database, database_initialization: "prepared" });
  downtown.queue.use({
    send: (message) => env.DOWNCITY_QUEUE.send(message, message.delay_ms
      ? { delaySeconds: Math.ceil(message.delay_ms / 1000) }
      : undefined),
  });
  const public_url_prefix = env.DOWNCITY_STORAGE_PUBLIC_URL_PREFIX?.trim();
  if (public_url_prefix) {
    downtown.storage(R2Storage({
      bucket: env.DOWNCITY_STORAGE,
      public_url_prefix,
    }));
  }
  downtown.use(new EnvService());
  const accounts_service = new AccountsService({
    providers: [
      githubAccountsProvider(),
      googleAccountsProvider(),
      wechatAccountsProvider(),
    ],
  });
  downtown.use(accounts_service);
  const credits_service = new CreditsService();
  const ai_service = new AIService({ credits: credits_service });
  downtown.use(credits_service);
  downtown.use(ai_service);
  downtown.use(new UsageService({
    ai_usage_reader: ai_service,
    credits_usage_reader: credits_service,
    account_usage_reader: accounts_service,
  }));
  return downtown;
}

/** fed deploy 通过远程 D1 代理调用；始终使用尚未 ready 的新实例。 */
export async function prepare_database(env: Env): Promise<void> {
  const downtown = create_downtown(env);
  await downtown.prepare_database();
}

/** 读取当前 Worker isolate 的 Downtown。 */
function get_downtown(env: Env): Downtown {
  downtown_instance ??= create_downtown(env);
  return downtown_instance;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const downtown = await get_downtown(env);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(await downtown.health());
    }
    return downtown.fetch(request);
  },
  async queue(batch: MessageBatch<DowntownQueueMessage>, env: Env): Promise<void> {
    const downtown = await get_downtown(env);
    for (const message of batch.messages) {
      try {
        await downtown.queue.call(message.body);
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
    .replace(/-{2,}/gu, "-") || "downtown";
}
