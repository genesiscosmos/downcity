#!/usr/bin/env node

/**
 * Downcity Node 街区入口。
 *
 * 负责在 Node.js 环境中启动一套可部署的 City。
 * 本地默认使用 `./data.sqlite`，容器部署时推荐通过
 * `DOWNCITY_FEDERATION_DATABASE_URL=file:/data/downfederation.sqlite` 指向持久化 volume。
 */

import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Federation, AIService } from "@downcity/city";
import {
  AccountsService,
  CreditsService,
  PaymentService,
  UsageService,
  githubAccountsProvider,
  googleAccountsProvider,
  stripePaymentProvider,
  wechatAccountsProvider,
} from "@downcity/services";
import * as models from "./models/index.js";

type RefreshableCity = {
  runtime?: {
    env?: {
      refresh(): Promise<void>;
    };
  };
};

interface EnvRow {
  [key: string]: unknown;

  /**
   * 环境变量名。
   */
  key: string;

  /**
   * 环境变量值。
   */
  value: string;

  /**
   * 创建时间。
   */
  created_at: string;

  /**
   * 更新时间。
   */
  updated_at: string;
}

/**
 * 解析 SQLite 数据库路径。
 *
 * 关键说明（中文）
 * - templates/node 当前使用 better-sqlite3，只支持本地 SQLite 文件。
 * - `file:` 前缀便于 Compose / Dokploy 和本地 .env 使用同一套表达。
 * - Postgres 等远端数据库后续应通过独立 adapter 接入，不在这里偷偷兼容。
 */
function resolve_sqlite_path(database_url: string | undefined): string {
  if (!database_url) {
    return "./data.sqlite";
  }

  if (!database_url.startsWith("file:")) {
    throw new Error("templates/node only supports file: SQLite URLs in DOWNCITY_FEDERATION_DATABASE_URL.");
  }

  const path = database_url.slice("file:".length).trim();
  if (!path) {
    throw new Error("DOWNCITY_FEDERATION_DATABASE_URL must include a SQLite file path.");
  }

  return path;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "43127", 10);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be a valid TCP port number.");
}

const sqlite_path = resolve_sqlite_path(process.env.DOWNCITY_FEDERATION_DATABASE_URL);
const sqlite = new Database(sqlite_path);
sqlite.pragma("journal_mode = WAL");

const db = drizzle(sqlite);

const bootstrap_env_keys = [
  "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY",
  "BETTER_AUTH_SECRET",
  "DEEPSEEK_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

/**
 * 同步本地 .env 到 City env 表。
 *
 * 关键说明（中文）
 * - City 默认把 env 托管在数据库中，服务运行时只读 City env 表。
 * - 本地模板允许开发者用 `.env` 配置启动参数，因此这里显式同步关键密钥。
 * - 空值和占位值不会写入，避免把示例配置误认为真实 provider key。
 */
async function sync_local_env(federation: Federation): Promise<void> {
  const env_table = await federation.table<EnvRow>("env");
  for (const key of bootstrap_env_keys) {
    const value = process.env[key]?.trim();
    if (!value || value === "sk-...") continue;
    const now = new Date().toISOString();
    const existing = await env_table.select({ key });
    if (existing.length > 0) {
      await env_table.update({ where: { key }, values: { value, updated_at: now } });
      continue;
    }
    await env_table.insert({ key, value, created_at: now, updated_at: now });
  }

  await (federation as unknown as RefreshableCity).runtime?.env?.refresh();
}

/**
 * 直接装配 Node City。
 *
 * 关键点（中文）
 * - 不再通过 compose_city 函数隐藏装配过程，所有 service 的创建与注册都平铺在这里。
 * - Payment 在 paid 后通过 CreditsService 发放额度，AI 通过 CreditsService 扣费。
 */
const federation = new Federation({ db });

const accounts = new AccountsService({
  token_ttl: "7d",
  providers: [
    githubAccountsProvider(),
    googleAccountsProvider(),
    wechatAccountsProvider(),
  ],
});
federation.use(accounts);

const credits = new CreditsService();
federation.use(credits);

const payment = new PaymentService({
  resolve_topup: ({ topup_amount_minor }) => ({
    credits: topup_amount_minor * 10_000,
  }),
  on_paid: async (record) => {
    await credits.topup({
      card: { kind: "primary", user_id: record.user_id },
      credits: record.credits,
      source: "payment",
      ref: record.payment_id,
      idempotency_key: `payment:${record.payment_id}`,
    });
  },
  providers: [stripePaymentProvider()],
});
federation.use(payment);

const usage = new UsageService({ record_errors: true });
federation.use(usage);

const ai = new AIService({ credits });
ai.use(Object.values(models));
federation.use(ai);

await federation.health();
await sync_local_env(federation);
const env_table = await federation.table<EnvRow>("env");
const admin_key = (await env_table.select({ key: "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY" }))[0]?.value ?? "(not set)";
serve({ fetch: (request) => federation.fetch(request), port, hostname: host });
console.log(`Downcity http://${host}:${port}`);
console.log(`SQLite: ${sqlite_path}`);
console.log(`Admin key: ${admin_key}`);
