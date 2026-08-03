/**
 * Federation 组装模块。
 *
 * 关键说明（中文）
 * - 用户显式传入继承 City Database 基类的 Adapter。
 * - City 只按 schema_id 选择内置 Schema，不理解具体 Driver。
 */

import { pgEnv, sqliteEnv } from "../service/env/schema.js";
import {
  pg_federation_auth_keys,
  sqlite_federation_auth_keys,
} from "./auth/key-schema.js";
import { pg_bureau_tokens, sqlite_bureau_tokens } from "./auth/bureau-token-schema.js";
import { EnvStore } from "../service/env/env-store.js";
import {
  pg_bureau_servers,
  pg_bureaus,
  sqlite_bureau_servers,
  sqlite_bureaus,
} from "../service/bureaus/schema.js";
import { normalizeEnvKey, parseDotenvEntries } from "../utils/helpers.js";
import type { FederationOptions } from "./types.js";
import type { BuiltinTables, EnvProvider, Runtime } from "./runtime.js";
import type { EnvEntry, EnvUpsertInput } from "../service/env/types.js";

/**
 * 从 FederationOptions 创建 runtime。
 *
 * 关键说明（中文）
 * - Database Adapter 显式声明 schema_id。
 * - Federation 不再读取 Drizzle dialect 或底层 Client。
 */
export function create_federation_runtime(options: FederationOptions): Runtime {
  const builtin_tables = builtin_tables_for(options.database.schema_id);

  return {
    database: options.database,
    env: new DatabaseEnvProvider(),
    builtinTables: builtin_tables,
    storage: options.storage,
  };
}

/**
 * 推断 Federation 内置表定义。
 */
function builtin_tables_for(schema_id: string): BuiltinTables {
  if (schema_id !== "sqlite" && schema_id !== "postgresql") {
    throw new Error(`Federation built-in schemas do not support ${schema_id}`);
  }
  return schema_id === "postgresql"
    ? {
        bureaus: pg_bureaus,
        bureau_servers: pg_bureau_servers,
        env: pgEnv,
        federation_auth_keys: pg_federation_auth_keys,
        bureau_tokens: pg_bureau_tokens,
      }
    : {
        bureaus: sqlite_bureaus,
        bureau_servers: sqlite_bureau_servers,
        env: sqliteEnv,
        federation_auth_keys: sqlite_federation_auth_keys,
        bureau_tokens: sqlite_bureau_tokens,
      };
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
