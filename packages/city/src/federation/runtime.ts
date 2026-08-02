/**
 * Runtime 能力接口模块。
 *
 * 定义 Federation 内部依赖的能力集合。用户侧只需要传入 Drizzle db，
 * City 会从 db 组装这些能力。
 *
 * 使用示例：
 * ```ts
 * const base = new Federation({ database });
 * ```
 */

import type { Database } from "../database/Database.js";
import type { EnvEntry, EnvUpsertInput } from "../service/env/types.js";
import type { EnvStore } from "../service/env/env-store.js";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { FederationStorage } from "./storage.js";

/** 表定义类型（SQLite 或 Postgres） */
export type TableDef = AnySQLiteTable | AnyPgTable;

/** Federation 当前数据库方言。 */
// ===========================================================================
// EnvProvider — 环境变量提供者接口
// ===========================================================================

/**
 * 环境变量提供者接口。
 *
 * City 通过此接口读取/写入运行时环境变量。
 */
export interface EnvProvider {
  /**
   * 读取单个环境变量。
   *
   * @param key - 环境变量名（会自动标准化）
   */
  get(key: string): string | undefined;

  /**
   * 主动刷新当前 provider 的读取视图。
   *
   * 关键说明（中文）
   * - City 启动时会初始化一次 env cache。
   * - 管理端直接修改数据库后，可通过 EnvService refresh action 显式刷新。
   */
  refresh(): Promise<void>;

  /**
   * 列出所有环境变量（含来源信息）。
   */
  list(): EnvEntry[] | Promise<EnvEntry[]>;

  /**
   * 写入或更新环境变量。
   *
   * @param input - 环境变量键值
   */
  upsert(input: EnvUpsertInput): Promise<EnvEntry>;

  /**
   * 仅在数据库不存在对应 key 时写入，并返回并发竞争后的数据库值。
   *
   * @param input - 环境变量默认键值
   */
  ensure(input: EnvUpsertInput): Promise<EnvEntry>;

  /**
   * 删除环境变量。
   *
   * @param key - 环境变量名
   */
  remove(key: string): Promise<void>;

  /**
   * 批量导入环境变量文本（.env 格式）。
   *
   * @param raw - .env 文本内容
   */
  import(raw: unknown): Promise<EnvEntry[]>;

  /**
   * 关联数据库存储。
   *
   * Federation 初始化内置 env 表后调用。
   * 默认 env provider 会把 Federation env 表作为唯一业务 env 来源。
   */
  attachStore(store: EnvStore): Promise<void>;
}

// ===========================================================================
// BuiltinTables — Federation 内置表定义
// ===========================================================================

/**
 * Federation 内置表定义。
 *
 * 包含 Bureau、Env、签名密钥和 Bureau Token 内置表。
 * 适配器根据数据库类型（SQLite / Postgres）提供对应的表定义。
 */
export interface BuiltinTables {
  /** Federation 稳定 Bureau 身份表。 */
  bureaus: TableDef;
  /** 环境变量表 */
  env: TableDef;
  /** Federation 用户 token Ed25519 Key Ring 表。 */
  federation_auth_keys: TableDef;
  /** Federation Bureau Token 表。 */
  bureau_tokens: TableDef;
}

// ===========================================================================
// Runtime — 运行时适配器接口
// ===========================================================================

/**
 * 运行时能力接口。
 *
 * 这是 Federation 内部从 Drizzle db 组装出来的结构，不作为用户主要入口。
 */
export interface Runtime {
  /** Federation 唯一主数据库 Adapter。 */
  database: Database;

  /**
   * 环境变量提供者。
   *
   * 用于读取密钥、API key 等配置。
   */
  env: EnvProvider;

  /**
   * Federation 内置表定义。
   *
   * 适配器根据数据库类型提供正确的 Drizzle 表定义。
   */
  builtinTables: BuiltinTables;

  /**
   * 服务公网 URL（http://localhost:43127 或 https://xxx.workers.dev）。
   * 用于 OAuth callback、邮件链接等。
   */
  baseURL?: string;

  /**
   * Federation 默认存储后端。
   *
   * 关键说明（中文）
   * - 用于把运行期产生的外部资源转存到自有存储。
   * - 未配置时相关 Service 保持原始 URL 行为。
   */
  storage?: FederationStorage;
}
