/**
 * Cloudflare D1 Service 乐观事务模块。
 *
 * D1 不提供跨 JavaScript 检查点的交互式事务。本模块先执行事务读取并缓存写命令，
 * 提交时使用快照守卫验证所有读取仍然有效，再通过 D1 batch 原子提交守卫与写入。
 * 快照发生变化时会重跑完整 handler，上层仍然只使用 context.transaction。
 */

import { and, eq, getTableColumns, getTableName, type SQL } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { CityTableApi } from "./table-api.js";
import type { Database, DbClient } from "./db.js";
import type {
  CompiledQuery,
  D1PreparedStatement,
  D1ReadSnapshot,
} from "./types/D1Transaction.js";

const transaction_guard_table = "__downcity_d1_transaction_guard";
const transaction_guard_column = "__downcity_d1_transaction_guard_marker";
const transaction_conflict_marker = "conflict";
const max_transaction_attempts = 8;
const guard_table_initializations = new WeakMap<object, Promise<void>>();

type TableSchema = AnySQLiteTable | AnyPgTable;

/** 单次 D1 事务尝试维护的 Unit of Work。 */
class D1TransactionUnit {
  private readonly read_snapshots: D1ReadSnapshot[] = [];
  private readonly write_queries: CompiledQuery[] = [];

  constructor(
    private readonly database: Database,
    private readonly client: DbClient,
  ) {}

  /** 为 Service 表创建事务绑定的 Table API。 */
  table<TRow extends Record<string, unknown>>(schema: TableSchema): CityTableApi<TRow> {
    return new D1TransactionTableApi<TRow>(this, this.database, schema);
  }

  /** 记录读取快照，供提交阶段检测并发修改。 */
  record_read(table_name: string, where: Record<string, unknown>, rows: Record<string, unknown>[]): void {
    this.read_snapshots.push({
      table_name,
      where: { ...where },
      rows: rows.map((row) => ({ ...row })),
    });
  }

  /** 缓存一条将在 D1 batch 内执行的写命令。 */
  record_write(query: CompiledQuery): void {
    this.write_queries.push({ sql: query.sql, params: [...query.params] });
  }

  /** 原子验证快照并提交全部写命令。 */
  async commit(): Promise<void> {
    if (this.read_snapshots.length === 0 && this.write_queries.length === 0) return;
    if (typeof this.client.prepare !== "function" || typeof this.client.batch !== "function") {
      throw new Error("D1 transaction requires prepare() and batch()");
    }
    const queries = [
      ...this.read_snapshots.map(build_snapshot_guard_query),
      ...this.write_queries,
    ];
    const statements = queries.map((query) => prepare_statement(this.client, query));
    await this.client.batch(statements);
  }
}

/** D1 事务绑定的 Table API；读取即时执行，写入延迟到原子提交阶段。 */
class D1TransactionTableApi<TRow extends Record<string, unknown>> implements CityTableApi<TRow> {
  readonly name: string;
  readonly schema: TableSchema;

  constructor(
    private readonly unit: D1TransactionUnit,
    private readonly database: Database,
    schema: TableSchema,
  ) {
    this.schema = schema;
    this.name = getTableName(schema);
  }

  async select(where: Partial<TRow> = {}): Promise<TRow[]> {
    const normalized_where = where as Record<string, unknown>;
    const condition = build_condition(this.schema, normalized_where);
    const query = this.database.select().from(this.schema as unknown);
    const rows = condition
      ? await (query as { where(value: SQL | undefined): Promise<Record<string, unknown>[]> }).where(condition)
      : await (query as Promise<Record<string, unknown>[]>);
    const copied_rows = rows.map((row) => ({ ...row })) as TRow[];
    this.unit.record_read(this.name, normalized_where, copied_rows);
    return copied_rows;
  }

  async insert(values: Partial<TRow> | Partial<TRow>[]): Promise<void> {
    const rows = Array.isArray(values) ? values : [values];
    if (rows.length === 0) throw new TypeError("insert() values cannot be empty");
    const query = this.database.insert(this.schema as unknown).values(rows as Record<string, unknown>[]);
    this.unit.record_write(query.toSQL());
  }

  async insert_if_absent(value: Partial<TRow>): Promise<void> {
    if (Object.keys(value).length === 0) throw new TypeError("insert_if_absent() value cannot be empty");
    const query = this.database
      .insert(this.schema as unknown)
      .values(value as Record<string, unknown>)
      .onConflictDoNothing();
    this.unit.record_write(query.toSQL());
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
    return matched_rows.length;
  }

  async delete(where: Partial<TRow>): Promise<number> {
    const condition = build_condition(this.schema, where as Record<string, unknown>);
    if (!condition) throw new TypeError("delete() where cannot be empty");
    const matched_rows = await this.select(where);
    const query = this.database.delete(this.schema as unknown).where(condition);
    this.unit.record_write(query.toSQL());
    return matched_rows.length;
  }
}

/** 执行 D1 乐观事务；只有快照冲突会自动重试。 */
export async function run_d1_service_transaction<TResult>(input: {
  /** 当前 Drizzle D1 数据库。 */
  database: Database;
  /** 当前 D1 Client。 */
  client: DbClient;
  /** 使用事务绑定 Table API 执行业务逻辑。 */
  handler(table: <TRow extends Record<string, unknown>>(schema: TableSchema) => CityTableApi<TRow>): Promise<TResult>;
}): Promise<TResult> {
  await ensure_transaction_guard_table(input.client);
  for (let attempt = 1; attempt <= max_transaction_attempts; attempt += 1) {
    const unit = new D1TransactionUnit(input.database, input.client);
    const result = await input.handler((schema) => unit.table(schema));
    try {
      await unit.commit();
      return result;
    } catch (error) {
      if (!is_transaction_conflict(error) || attempt === max_transaction_attempts) throw error;
    }
  }
  throw new Error("D1 transaction retry exhausted");
}

/** 创建只在快照失效时违反 CHECK 约束的守卫语句。 */
function build_snapshot_guard_query(snapshot: D1ReadSnapshot): CompiledQuery {
  const params: unknown[] = [];
  const where_sql = build_equal_condition_sql(snapshot.where);
  params.push(...Object.values(snapshot.where), snapshot.rows.length);
  const predicates = [`(SELECT COUNT(*) FROM ${quote_identifier(snapshot.table_name)} WHERE ${where_sql}) = ?`];
  for (const row of snapshot.rows) {
    const row_sql = build_equal_condition_sql(row);
    predicates.push(`EXISTS (SELECT 1 FROM ${quote_identifier(snapshot.table_name)} WHERE ${where_sql} AND ${row_sql})`);
    params.push(...Object.values(snapshot.where), ...Object.values(row));
  }
  return {
    sql: `INSERT INTO ${quote_identifier(transaction_guard_table)} (${quote_identifier(transaction_guard_column)}) SELECT ? WHERE NOT (${predicates.join(" AND ")})`,
    params: [transaction_conflict_marker, ...params],
  };
}

/** 将字段集合转换为使用 D1 绑定参数的 NULL-safe 等值条件。 */
function build_equal_condition_sql(values: Record<string, unknown>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return "1 = 1";
  return entries.map(([key]) => `${quote_identifier(key)} IS ?`).join(" AND ");
}

/** 构造 Drizzle 等值条件。 */
function build_condition(schema: TableSchema, where: Record<string, unknown>): SQL | undefined {
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

/** 将编译后的查询转换为 D1 预编译语句。 */
function prepare_statement(client: DbClient, query: CompiledQuery): D1PreparedStatement {
  const statement = client.prepare!(query.sql);
  return statement.bind(...query.params);
}

/** 幂等创建内部冲突守卫表；正常提交不会向表中留下数据。 */
async function ensure_transaction_guard_table(client: DbClient): Promise<void> {
  if (typeof client.exec !== "function") throw new Error("D1 transaction requires exec()");
  const key = client as object;
  const current = guard_table_initializations.get(key);
  if (current) return await current;
  const initialization = Promise.resolve(client.exec(
    `CREATE TABLE IF NOT EXISTS ${quote_identifier(transaction_guard_table)} (`
      + `${quote_identifier(transaction_guard_column)} TEXT NOT NULL `
      + `CHECK (${quote_identifier(transaction_guard_column)} = 'valid'))`,
  )).then(() => undefined);
  guard_table_initializations.set(key, initialization);
  try {
    await initialization;
  } catch (error) {
    guard_table_initializations.delete(key);
    throw error;
  }
}

/** 识别内部守卫表产生的 CHECK 约束冲突。 */
function is_transaction_conflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const record = current as { message?: unknown; cause?: unknown };
    if (String(record.message ?? current).includes(transaction_guard_column)) return true;
    current = record.cause;
  }
  return false;
}
