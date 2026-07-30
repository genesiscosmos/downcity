/** PostgreSQL Federation Database Adapter。 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
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
import type { DatabaseOptions } from "./types/DatabaseOptions.js";

/** 使用 postgres-js 的 PostgreSQL Federation Database。 */
export class Database extends CityDatabase {
  private readonly client: ReturnType<typeof postgres>;

  constructor(options: DatabaseOptions) {
    const url = String(options?.url ?? "").trim();
    if (!url) throw new TypeError("PostgreSQL Database url is required");
    const client = postgres(url);
    const drizzle_database = drizzle(client) as unknown as DrizzleDatabase;
    super({ schema_id: "postgresql", drizzle: drizzle_database });
    this.client = client;
  }

  protected on_table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow> {
    return new TableApi(this.drizzle, schema) as unknown as CityTableApi<TRow>;
  }

  protected async on_ensure_table(schema: FederationTableSchema): Promise<void> {
    const ddl = build_create_table_sql(schema);
    if (ddl) await this.client.unsafe(ddl);
  }

  protected async on_execute_ddl(statement: string): Promise<void> {
    await this.client.unsafe(statement);
  }

  protected async on_query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>> {
    const result = await this.client.unsafe(statement.sql, statement.params as never[]);
    return {
      rows: Array.from(result, (row) => ({ ...row }) as unknown as TRow),
      changes: Number(result.count ?? 0),
    };
  }

  protected async on_atomic(
    statements: DatabaseStatement[],
  ): Promise<DatabaseMutationResult[]> {
    return await this.client.begin(async (transaction) => {
      const results: DatabaseMutationResult[] = [];
      for (const statement of statements) {
        const result = await transaction.unsafe(statement.sql, statement.params as never[]);
        results.push({ changes: Number(result.count ?? 0) });
      }
      return results;
    });
  }

  protected async on_transaction<TResult>(
    handler: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    if (typeof this.drizzle.transaction !== "function") {
      throw new Error("PostgreSQL Drizzle database does not expose transaction()");
    }
    return await this.drizzle.transaction(async (transaction_database) =>
      await handler({
        table: <TRow extends Record<string, unknown>>(schema: FederationTableSchema) =>
          new TableApi(transaction_database, schema) as unknown as CityTableApi<TRow>,
      }));
  }

  protected async on_dispose(): Promise<void> {
    await this.client.end();
  }
}

/** 根据 PostgreSQL Drizzle Schema 生成建表语句。 */
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

/** 安全引用 PostgreSQL 标识符。 */
function quote_identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
