/**
 * Federation 组装模块。
 *
 * 关键说明（中文）
 * - 用户只需要传入 Drizzle db，方言、底层 client 全部由 City 自己从 db 推断。
 * - 用户既不需要传 `dialect`，也不需要传 `raw`，避免参数语义重复。
 */

import { pgEnv, sqliteEnv } from "../service/env/schema.js";
import {
  pg_federation_auth_keys,
  sqlite_federation_auth_keys,
} from "./auth/key-schema.js";
import { pg_bureau_tokens, sqlite_bureau_tokens } from "./auth/bureau-token-schema.js";
import { EnvStore } from "../service/env/env-store.js";
import { pgCities, sqliteCities } from "../service/cities/schema.js";
import { normalizeEnvKey, parseDotenvEntries } from "../utils/helpers.js";
import type { FederationOptions } from "./types.js";
import type { DbClient } from "../store/db.js";
import type { BuiltinTables, EnvProvider, Runtime } from "./runtime.js";
import type { EnvEntry, EnvUpsertInput } from "../service/env/types.js";

/**
 * 从 FederationOptions 创建 runtime。
 *
 * 关键说明（中文）
 * - 通过 Drizzle 暴露的 `db.dialect` 自动推断 sqlite / pg 方言。
 * - 通过 `db.$client` 提取底层 client，既用于 DDL 也作为 raw 暴露给需要它的 service。
 */
export function create_federation_runtime(options: FederationOptions): Runtime {
  const dialect = infer_dialect(options.db);
  const builtin_tables = builtin_tables_for(dialect);
  const client = extract_db_client(options.db);

  return {
    dialect: dialect === "pg" ? "postgresql" : "sqlite",
    database: options.db,
    client,
    env: new DatabaseEnvProvider(),
    builtinTables: builtin_tables,
    raw: options.db.$client,
    storage: options.storage,
  };
}

/**
 * 推断 Federation 内置表定义。
 */
function builtin_tables_for(dialect: "pg" | "sqlite"): BuiltinTables {
  return dialect === "pg"
    ? {
        cities: pgCities,
        env: pgEnv,
        federation_auth_keys: pg_federation_auth_keys,
        bureau_tokens: pg_bureau_tokens,
      }
    : {
        cities: sqliteCities,
        env: sqliteEnv,
        federation_auth_keys: sqlite_federation_auth_keys,
        bureau_tokens: sqlite_bureau_tokens,
      };
}

/**
 * 从 Drizzle 实例推断方言。
 *
 * 关键说明（中文）
 * - Drizzle v0.30+ 会在 db 上挂一个 `dialect` 实例（SQLiteSyncDialect / SQLiteAsyncDialect / PgDialect）。
 * - 我们直接读 dialect 实例的构造函数名，比读 db 自身名字更稳定，覆盖 better-sqlite3 / d1 / node-sqlite / pg。
 */
function infer_dialect(db: { dialect?: unknown; constructor?: { name?: string } }): "pg" | "sqlite" {
  const dialect_name = (db.dialect as { constructor?: { name?: string } } | undefined)?.constructor?.name ?? "";
  if (/SQLite/i.test(dialect_name)) return "sqlite";
  if (/Pg/i.test(dialect_name)) return "pg";
  const ctor_name = db.constructor?.name ?? "";
  if (/sqlite|d1/i.test(ctor_name)) return "sqlite";
  if (/pg|postgres/i.test(ctor_name)) return "pg";
  throw new Error("Unable to infer Drizzle dialect from db. Please pass a Drizzle SQLite or Postgres database.");
}

/**
 * 提取底层数据库 client。
 */
function extract_db_client(db: { $client?: unknown }): DbClient {
  const client = db.$client;
  if (client && typeof client === "object") {
    return client as DbClient;
  }
  if (typeof client === "function") {
    return {
      unsafe: (sql: string, params?: unknown[]) =>
        (client as (query: string, values?: unknown[]) => Promise<unknown>)(sql, params),
    };
  }
  throw new Error("Drizzle db must expose $client so City can initialize tables.");
}

/**
 * 数据库存储的 env provider。
 *
 * 关键说明（中文）
 * - City 把所有系统与业务 env 统一托管到 env 表
 * - 运行时通过内存 cache 加速读取，管理端修改或显式 refresh 时更新视图
 */
class DatabaseEnvProvider implements EnvProvider {
  private store?: EnvStore;
  private readonly cache = new Map<string, string>();

  async attachStore(store: EnvStore): Promise<void> {
    this.store = store;
    await this.refresh();
  }

  get(key: string): string | undefined {
    return this.cache.get(normalizeEnvKey(key));
  }

  async refresh(): Promise<void> {
    if (!this.store) return;
    const entries = await this.store.list();
    this.cache.clear();
    for (const entry of entries) {
      this.cache.set(entry.key, entry.value);
    }
  }

  async list(): Promise<EnvEntry[]> {
    await this.refresh();
    return [...this.cache.entries()].map(([key, value]) => ({
      key,
      value,
      source: "database" as const,
    }));
  }

  async upsert(input: EnvUpsertInput): Promise<EnvEntry> {
    if (!this.store) throw new Error("Env store is not ready");
    const entry = await this.store.upsert(input);
    this.cache.set(entry.key, entry.value);
    return entry;
  }

  async ensure(input: EnvUpsertInput): Promise<EnvEntry> {
    if (!this.store) throw new Error("Env store is not ready");
    const entry = await this.store.ensure(input);
    this.cache.set(entry.key, entry.value);
    return entry;
  }

  async remove(key: string): Promise<void> {
    if (!this.store) throw new Error("Env store is not ready");
    const normalized_key = normalizeEnvKey(key);
    await this.store.remove(normalized_key);
    this.cache.delete(normalized_key);
  }

  async import(raw: unknown): Promise<EnvEntry[]> {
    const entries = parseDotenvEntries(raw);
    const stored: EnvEntry[] = [];
    for (const entry of entries) {
      stored.push(await this.upsert(entry));
    }
    return stored;
  }
}
