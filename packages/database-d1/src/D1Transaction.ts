/** Cloudflare D1 乐观事务实现。 */

import { and, eq, getTableColumns, getTableName, type SQL } from "drizzle-orm";
import {
  DatabaseTransactionConflictError,
  type CityTableApi,
  type DatabaseTransaction,
  type DrizzleDatabase,
  type FederationTableSchema,
} from "@downcity/city";
import type {
  CompiledQuery,
  ReadSnapshot,
  TransactionMutation,
} from "./types/Transaction.js";

const guard_table = "__downcity_d1_transaction_guard";
const guard_column = "__downcity_d1_transaction_guard_marker";
const conflict_marker = "conflict";

/** 单次事务尝试维护的读取快照和延迟写命令。 */
class TransactionUnit {
  private readonly snapshots: ReadSnapshot[] = [];
  private readonly writes: CompiledQuery[] = [];
  private readonly mutations: TransactionMutation[] = [];

  constructor(
    private readonly database: DrizzleDatabase,
    private readonly binding: D1Database,
  ) {}

  /** 创建 D1 事务绑定的 Table API。 */
  table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow> {
    return new TransactionTableApi<TRow>(this, this.database, schema);
  }

  /** 保存读取结果，供提交时验证。 */
  record_read(
    table_name: string,
    where: Record<string, unknown>,
    rows: Record<string, unknown>[],
  ): void {
    this.snapshots.push({
      table_name,
      where: { ...where },
      rows: rows.map((row) => ({ ...row })),
    });
  }

  /** 缓存提交阶段执行的写命令。 */
  record_write(query: CompiledQuery): void {
    this.writes.push({ sql: query.sql, params: [...query.params] });
  }

  /** 保存结构化写入，使后续读取可以看到本次事务尚未提交的变化。 */
  record_mutation(mutation: TransactionMutation): void {
    this.mutations.push(mutation);
  }

  /** 将当前事务的全部延迟写入投影到数据库快照。 */
  project_rows(
    table_name: string,
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    let projected_rows = rows.map((row) => ({ ...row }));
    for (const mutation of this.mutations) {
      if (mutation.table_name !== table_name) continue;
      if (mutation.kind === "insert") {
        projected_rows.push(...mutation.rows.map((row) => ({ ...row })));
        continue;
      }
      if (mutation.kind === "insert_if_absent") {
        const conflict_keys = mutation.unique_keys.length > 0
          ? mutation.unique_keys
          : Object.keys(mutation.row);
        const exists = projected_rows.some((row) =>
          conflict_keys.every((key) => Object.is(row[key], mutation.row[key])));
        if (!exists) projected_rows.push({ ...mutation.row });
        continue;
      }
      if (mutation.kind === "update") {
        projected_rows = projected_rows.map((row) => matches_where(row, mutation.where)
          ? { ...row, ...mutation.values }
          : row);
        continue;
      }
      projected_rows = projected_rows.filter((row) => !matches_where(row, mutation.where));
    }
    return projected_rows;
  }

  /** 原子验证全部快照并提交写命令。 */
  async commit(): Promise<void> {
    if (this.snapshots.length === 0 && this.writes.length === 0) return;
    const queries = [
      ...this.snapshots.map(build_guard_query),
      ...this.writes,
    ];
    const statements = queries.map((query) =>
      this.binding.prepare(query.sql).bind(...query.params));
    await this.binding.batch(statements);
  }
}

/** D1 事务 Table API。 */
class TransactionTableApi<TRow extends Record<string, unknown>> implements CityTableApi<TRow> {
  readonly name: string;
  readonly schema: FederationTableSchema;

  constructor(
    private readonly unit: TransactionUnit,
    private readonly database: DrizzleDatabase,
    schema: FederationTableSchema,
  ) {
    this.schema = schema;
    this.name = getTableName(schema);
  }

  async select(where: Partial<TRow> = {}): Promise<TRow[]> {
    const normalized_where = where as Record<string, unknown>;
    const query = this.database.select().from(this.schema as unknown);
    const rows = await (query as Promise<Record<string, unknown>[]>);
    const copied_rows = rows.map((row) => ({ ...row }));
    this.unit.record_read(this.name, {}, copied_rows);
    return this.unit
      .project_rows(this.name, copied_rows)
      .filter((row) => matches_where(row, normalized_where)) as TRow[];
  }

  async insert(values: Partial<TRow> | Partial<TRow>[]): Promise<void> {
    const rows = Array.isArray(values) ? values : [values];
    if (rows.length === 0) throw new TypeError("insert() values cannot be empty");
    const query = this.database.insert(this.schema as unknown).values(rows as Record<string, unknown>[]);
    this.unit.record_write(query.toSQL());
    this.unit.record_mutation({
      kind: "insert",
      table_name: this.name,
      rows: rows.map((row) => ({ ...row })),
    });
  }

  async insert_if_absent(value: Partial<TRow>): Promise<void> {
    if (Object.keys(value).length === 0) throw new TypeError("insert_if_absent() value cannot be empty");
    const query = this.database
      .insert(this.schema as unknown)
      .values(value as Record<string, unknown>)
      .onConflictDoNothing();
    this.unit.record_write(query.toSQL());
    const columns = getTableColumns(this.schema);
    const unique_keys = Object.entries(columns)
      .filter(([, column]) => column.primary || column.isUnique)
      .map(([key]) => key);
    this.unit.record_mutation({
      kind: "insert_if_absent",
      table_name: this.name,
      row: { ...value },
      unique_keys,
    });
  }

  async update(input: { where: Partial<TRow>; values: Partial<TRow> }): Promise<number> {
    if (Object.keys(input.values).length === 0) throw new TypeError("update() values cannot be empty");
    const condition = build_condition(this.schema, input.where as Record<string, unknown>);
    if (!condition) throw new TypeError("update() where cannot be empty");
    const matched_rows = await this.select(input.where);
    const query = this.database
      .update(this.schema as unknown)
      .set(input.values as Record<string, unknown>)
      .where(condition);
    this.unit.record_write(query.toSQL());
    this.unit.record_mutation({
      kind: "update",
      table_name: this.name,
      where: { ...input.where },
      values: { ...input.values },
    });
    return matched_rows.length;
  }

  async delete(where: Partial<TRow>): Promise<number> {
    const condition = build_condition(this.schema, where as Record<string, unknown>);
    if (!condition) throw new TypeError("delete() where cannot be empty");
    const matched_rows = await this.select(where);
    const query = this.database.delete(this.schema as unknown).where(condition);
    this.unit.record_write(query.toSQL());
    this.unit.record_mutation({
      kind: "delete",
      table_name: this.name,
      where: { ...where },
    });
    return matched_rows.length;
  }
}

/** 判断记录是否满足全部等值条件。 */
function matches_where(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, value]) => Object.is(row[key], value));
}

/** 执行带有限冲突重试的 D1 事务。 */
export async function run_transaction<TResult>(input: {
  /** 当前 Drizzle D1 实例。 */
  database: DrizzleDatabase;
  /** 当前 D1 binding。 */
  binding: D1Database;
  /** 最大事务尝试次数。 */
  max_attempts: number;
  /** 上层事务 handler。 */
  handler: (transaction: DatabaseTransaction) => Promise<TResult>;
}): Promise<TResult> {
  await ensure_guard_table(input.binding);
  let last_error: unknown;
  for (let attempt = 1; attempt <= input.max_attempts; attempt += 1) {
    const unit = new TransactionUnit(input.database, input.binding);
    const result = await input.handler({
      table: <TRow extends Record<string, unknown>>(schema: FederationTableSchema) =>
        unit.table<TRow>(schema),
    });
    try {
      await unit.commit();
      return result;
    } catch (error) {
      last_error = error;
      if (!is_snapshot_conflict(error)) throw error;
    }
  }
  throw new DatabaseTransactionConflictError({ cause: last_error });
}

/** 生成只在快照变化时违反 CHECK 约束的守卫。 */
function build_guard_query(snapshot: ReadSnapshot): CompiledQuery {
  const params: unknown[] = [];
  const where_sql = build_equal_sql(snapshot.where);
  params.push(...Object.values(snapshot.where), snapshot.rows.length);
  const predicates = [
    `(SELECT COUNT(*) FROM ${quote_identifier(snapshot.table_name)} WHERE ${where_sql}) = ?`,
  ];
  for (const row of snapshot.rows) {
    const row_sql = build_equal_sql(row);
    predicates.push(
      `EXISTS (SELECT 1 FROM ${quote_identifier(snapshot.table_name)} WHERE ${where_sql} AND ${row_sql})`,
    );
    params.push(...Object.values(snapshot.where), ...Object.values(row));
  }
  return {
    sql: `INSERT INTO ${quote_identifier(guard_table)} (${quote_identifier(guard_column)}) SELECT ? WHERE NOT (${predicates.join(" AND ")})`,
    params: [conflict_marker, ...params],
  };
}

/** 构造 NULL-safe 参数等值条件。 */
function build_equal_sql(values: Record<string, unknown>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return "1 = 1";
  return entries.map(([key]) => `${quote_identifier(key)} IS ?`).join(" AND ");
}

/** 构造 Drizzle 等值条件。 */
function build_condition(
  schema: FederationTableSchema,
  where: Record<string, unknown>,
): SQL | undefined {
  const entries = Object.entries(where);
  if (entries.length === 0) return undefined;
  const columns = getTableColumns(schema);
  return and(...entries.map(([key, value]) => {
    const column = columns[key];
    if (!column) throw new TypeError(`Unknown column for ${getTableName(schema)}: ${key}`);
    return eq(column, value);
  }));
}

/** 安全引用 SQLite 标识符。 */
function quote_identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** 幂等创建内部守卫表。 */
async function ensure_guard_table(binding: D1Database): Promise<void> {
  await binding.prepare(
    `CREATE TABLE IF NOT EXISTS ${quote_identifier(guard_table)} (`
      + `${quote_identifier(guard_column)} TEXT NOT NULL `
      + `CHECK (${quote_identifier(guard_column)} = 'valid'))`,
  ).run();
}

/** 识别内部守卫产生的快照冲突。 */
function is_snapshot_conflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const record = current as { message?: unknown; cause?: unknown };
    if (String(record.message ?? current).includes(guard_column)) return true;
    current = record.cause;
  }
  return false;
}
