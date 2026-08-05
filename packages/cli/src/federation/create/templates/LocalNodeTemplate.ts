/**
 * Local Node.js Federation 内置模板。
 *
 * 关键说明（中文）
 * - 使用独立 SQLite Database Adapter 保存本地数据。
 * - 监听地址和端口由 `fed deploy` 通过 HOST / PORT 注入。
 * - 只装配本地账号、余额和 usage，保持模板最小且可直接扩展。
 */

import type {
  FederationTemplateFile,
  FederationTemplateInput,
} from "@/federation/types/FederationTemplate.js";

/** 创建 Local Node.js 模板文件。 */
export function create_local_node_template_files(
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
          target: "local",
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
          dev: "node --env-file-if-exists=.env --import tsx src/index.ts",
          start: "node --env-file-if-exists=.env --import tsx src/index.ts",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@downcity/city": "latest",
          "@downcity/database-sqlite": "latest",
          "@downcity/services": "latest",
          "@hono/node-server": "latest",
        },
        devDependencies: {
          "@types/node": "latest",
          tsx: "latest",
          typescript: "latest",
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
          types: ["node"],
        },
        include: ["src/**/*.ts"],
      }),
    },
    {
      path: ".env.example",
      content: [
        "# Local Federation runtime settings.",
        "DOWNCITY_FEDERATION_DATABASE_URL=file:./data.sqlite",
        "HOST=127.0.0.1",
        "# PORT is allocated by fed deploy when omitted.",
        "",
      ].join("\n"),
    },
    {
      path: ".gitignore",
      content: ["node_modules/", ".env", "data.sqlite", "data.sqlite-*", ""].join("\n"),
    },
    {
      path: "src/index.ts",
      content: create_local_entrypoint(),
    },
  ];
}

/** 创建最小本地 Federation 入口。 */
function create_local_entrypoint(): string {
  return `/**
 * Local Node.js Federation entry.
 *
 * 关键说明（中文）
 * - 本地数据库默认写入项目根目录的 data.sqlite。
 * - HOST / PORT 由 fed deploy 注入，也可以在 .env 中显式配置。
 * - local_login 仅适用于本机监听地址，不应直接暴露到公网。
 */

import { serve } from "@hono/node-server";
import { AIService, Federation } from "@downcity/city";
import { Database } from "@downcity/database-sqlite";
import {
  AccountsService,
  CreditsService,
  UsageService,
} from "@downcity/services";

/** Federation env 表中读取 admin key 所需的最小行类型。 */
interface EnvRow {
  /** 环境变量名称。 */
  key: string;
  /** 环境变量值。 */
  value: string;
  /** 允许表 API 返回其他系统字段。 */
  [key: string]: unknown;
}

/** 仅用于刷新 Federation env cache 的内部运行时视图。 */
interface RefreshableFederation {
  /** Federation 初始化后的内部 runtime。 */
  runtime?: {
    /** 数据库 env provider。 */
    env?: {
      /** 从 env 表重新加载运行时 cache。 */
      refresh(): Promise<void>;
    };
  };
}

/** 解析本地 SQLite 文件路径。 */
function resolve_sqlite_path(database_url: string | undefined): string {
  if (!database_url) return "./data.sqlite";
  if (!database_url.startsWith("file:")) {
    throw new Error("DOWNCITY_FEDERATION_DATABASE_URL must use a file: SQLite URL.");
  }
  const sqlite_path = database_url.slice("file:".length).trim();
  if (!sqlite_path) throw new Error("SQLite file path is required.");
  return sqlite_path;
}

/**
 * 同步 fed deploy 注入的 admin key。
 *
 * 关键说明（中文）
 * - CLI registry 与 Federation 数据库必须持有同一个 key。
 * - 同一 fed_id redeploy 会复用 key，不会无故使已有 admin 会话失效。
 */
async function sync_deployed_admin_key(federation: Federation): Promise<void> {
  const admin_secret_key = process.env.DOWNCITY_FEDERATION_ADMIN_SECRET_KEY?.trim();
  if (!admin_secret_key) return;
  const env_table = await federation.table<EnvRow>("env");
  const existing = await env_table.select({ key: "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY" });
  const now = new Date().toISOString();
  if (existing.length > 0) {
    await env_table.update({
      where: { key: "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY" },
      values: { value: admin_secret_key, updated_at: now },
    });
  } else {
    await env_table.insert({
      key: "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY",
      value: admin_secret_key,
      created_at: now,
      updated_at: now,
    });
  }
  await (federation as unknown as RefreshableFederation).runtime?.env?.refresh();
}

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "12314", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const database = new Database({
  filename: resolve_sqlite_path(process.env.DOWNCITY_FEDERATION_DATABASE_URL),
});
const federation = new Federation({ database });

const accounts_service = new AccountsService({ local_login: true });
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
await sync_deployed_admin_key(federation);
serve({
  hostname: host,
  port,
  fetch: (request) => federation.fetch(request),
});

console.log(\`Federation ready at http://\${host}:\${port}\`);
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
