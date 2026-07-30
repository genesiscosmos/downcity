/** Cloudflare D1 Federation Database Adapter。 */

import { drizzle } from "drizzle-orm/d1";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  Database as CityDatabase,
  TableApi,
  type CityTableApi,
  type DatabaseMutationResult,
  type DatabaseQueryResult,
  type DatabaseStatement,
  type DatabaseTransaction,
  type DrizzleDatabase,
  type FederationTableSchema,
} from "@downcity/city";
import { run_transaction } from "./D1Transaction.js";
import type { DatabaseOptions } from "./types/DatabaseOptions.js";

/** 使用 Cloudflare D1 binding 的 Federation Database。 */
export class Database extends CityDatabase {
  private readonly binding: D1Database;
  private readonly max_transaction_attempts: number;

  constructor(options: DatabaseOptions) {
    if (!options?.binding) throw new TypeError("D1 Database binding is required");
    const max_transaction_attempts = options.max_transaction_attempts ?? 8;
    if (!Number.isSafeInteger(max_transaction_attempts) || max_transaction_attempts <= 0) {
      throw new TypeError("max_transaction_attempts must be a positive integer");
    }
    const drizzle_database = drizzle(options.binding) as unknown as DrizzleDatabase;
    super({ schema_id: "sqlite", drizzle: drizzle_database });
    this.binding = options.binding;
    this.max_transaction_attempts = max_transaction_attempts;
  }

  protected on_table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow> {
    return new TableApi(this.drizzle, schema) as unknown as CityTableApi<TRow>;
  }

  protected async on_ensure_table(schema: FederationTableSchema): Promise<void> {
    const ddl = build_create_table_sql(schema);
    if (ddl) await this.binding.prepare(ddl).run();
  }

  protected async on_execute_ddl(statement: string): Promise<void> {
    await this.binding.prepare(statement).run();
  }

  protected async on_query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>> {
    const result = await this.binding.prepare(statement.sql).bind(
      ...statement.params,
    ).all<TRow>();
    return {
      rows: (result.results ?? []).map((row) => ({ ...row })),
      changes: Number(result.meta?.changes ?? 0),
    };
  }

  protected async on_atomic(
    statements: DatabaseStatement[],
  ): Promise<DatabaseMutationResult[]> {
    const prepared = statements.map((statement) =>
      this.binding.prepare(statement.sql).bind(...statement.params));
    const results = await this.binding.batch(prepared);
    return results.map((result) => ({ changes: Number(result.meta?.changes ?? 0) }));
  }

  protected async on_transaction<TResult>(
    handler: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return await run_transaction({
      database: this.drizzle,
      binding: this.binding,
      max_attempts: this.max_transaction_attempts,
      handler,
    });
  }

  protected async on_dispose(): Promise<void> {
    // D1 binding 生命周期由 Cloudflare Worker Runtime 持有。
  }
}

/** 根据 SQLite Drizzle Schema 生成 D1 建表语句。 */
function build_create_table_sql(schema: FederationTableSchema): string {
  const columns = Object.values(getTableColumns(schema));
  if (columns.length === 0) return "";
  const definitions = columns.map((column) => {
    const parts = [quote_identifier(column.name), column.getSQLType()];
    if (column.primary) parts.push("PRIMARY KEY");
    if (column.notNull && !column.primary) parts.push("NOT NULL");
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS ${quote_identifier(getTableName(schema))} (${definitions.join(", ")})`;
}

/** 安全引用 D1 标识符。 */
function quote_identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
