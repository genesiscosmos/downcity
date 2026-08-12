/**
 * 通用表操作模块。
 *
 * 基于 Drizzle query builder 提供动态用户表的 CRUD。
 * 构造时做一次 Database 转换，后续方法零类型断言。
 */

import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import {
  getTableColumns,
  getTableName,
  eq,
  and,
  type SQL,
} from "drizzle-orm";
import type { DrizzleDatabase } from "./db.js";
import { quoteIdent } from "../utils/helpers.js";

// ===========================================================================
// CityTableApi 类型
// ===========================================================================

export interface CityTableApi<TRow = Record<string, unknown>> {
  /** 表在数据库中的真实名称 */
  readonly name: string;
  /** 原始 Drizzle table 对象 */
  readonly schema: AnySQLiteTable | AnyPgTable;
  /** 读取表数据 */
  select(where?: Partial<TRow>): Promise<TRow[]>;
  /** 插入一行或多行数据 */
  insert(values: Partial<TRow> | Partial<TRow>[]): Promise<void>;
  /** 原子插入一行；命中任意唯一约束时保留数据库现有记录。 */
  insert_if_absent(value: Partial<TRow>): Promise<void>;
  /** 按 where 等值条件更新数据 */
  update(input: { where: Partial<TRow>; values: Partial<TRow> }): Promise<number>;
  /** 按 where 等值条件删除数据 */
  delete(where: Partial<TRow>): Promise<number>;
}

// ===========================================================================
// TableApi — 动态用户表 CRUD
// ===========================================================================

export class TableApi implements CityTableApi {
  readonly name: string;
  readonly schema: AnySQLiteTable | AnyPgTable;

  private readonly db: DrizzleDatabase;
  private readonly execute: <TResult>(handler: () => Promise<TResult>) => Promise<TResult>;

  constructor(
    db: DrizzleDatabase,
    schema: AnySQLiteTable | AnyPgTable,
    options: {
      execute?: <TResult>(handler: () => Promise<TResult>) => Promise<TResult>;
    } = {},
  ) {
    this.db = db;
    this.schema = schema;
    this.name = getTableName(schema);
    this.execute = options.execute ?? (async (handler) => await handler());
  }

  async select(where: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
    return await this.run(async () => {
      const cond = buildCondition(this.schema, where);
      const query = this.db.select().from(this.schema as unknown);
      const rows = cond
        ? await (query as { where(c: SQL | undefined): Promise<Record<string, unknown>[]> }).where(cond)
        : await (query as Promise<Record<string, unknown>[]>);
      return rows.map((row: Record<string, unknown>) => ({ ...row }));
    });
  }

  async insert(values: Record<string, unknown> | Record<string, unknown>[]): Promise<void> {
    const rows = Array.isArray(values) ? values : [values];
    if (rows.length === 0) throw new TypeError("insert() values cannot be empty");
    await this.run(async () => {
      await this.db.insert(this.schema as unknown).values(rows);
    });
  }

  async insert_if_absent(value: Record<string, unknown>): Promise<void> {
    if (Object.keys(value).length === 0) {
      throw new TypeError("insert_if_absent() value cannot be empty");
    }
    await this.run(async () => {
      await this.db
        .insert(this.schema as unknown)
        .values(value)
        .onConflictDoNothing();
    });
  }

  async update(input: {
    where: Record<string, unknown>;
    values: Record<string, unknown>;
  }): Promise<number> {
    if (Object.keys(input.values).length === 0) {
      throw new TypeError("update() values cannot be empty");
    }
    const cond = buildCondition(this.schema, input.where);
    if (!cond) throw new TypeError("update() where cannot be empty");
    // Drizzle update 返回类型因方言而异
    const result = await this.run(async () =>
      await this.db.update(this.schema as unknown).set(input.values).where(cond));
    return read_mutation_count(result);
  }

  async delete(where: Record<string, unknown>): Promise<number> {
    const cond = buildCondition(this.schema, where);
    if (!cond) throw new TypeError("delete() where cannot be empty");
    const result = await this.run(async () =>
      await this.db.delete(this.schema as unknown).where(cond));
    return read_mutation_count(result);
  }

  /** 通过 Adapter 注入的执行器运行数据库操作。 */
  private async run<TResult>(handler: () => Promise<TResult>): Promise<TResult> {
    return await this.execute(handler);
  }
}

/**
 * 读取不同 Drizzle 方言的变更行数。
 *
 * better-sqlite3 返回 `changes`，D1 返回 `meta.changes`，Postgres 常见驱动返回
 * `rowCount`；统一归一后，上层才能可靠实现 compare-and-set。
 */
function read_mutation_count(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const record = result as {
    changes?: unknown;
    count?: unknown;
    rowCount?: unknown;
    meta?: { changes?: unknown };
  };
  // postgres-js 的 RowList 继承 Array；必须先读 count，不能把无 RETURNING 的结果按 length=0 处理。
  const value = record.changes ?? record.count ?? record.rowCount ?? record.meta?.changes;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Array.isArray(result) ? result.length : 0;
}

// ===========================================================================
// 内部辅助
// ===========================================================================

function buildCondition(
  table: AnySQLiteTable | AnyPgTable,
  where: Record<string, unknown>,
): SQL | undefined {
  const entries = Object.entries(where);
  if (entries.length === 0) return undefined;

  const columns = getTableColumns(table);
  return and(...entries.map(([key, value]) => {
    const col = columns[key];
    if (!col) throw new TypeError(`Unknown column for ${getTableName(table)}: ${key}`);
    return eq(col, value);
  }));
}
