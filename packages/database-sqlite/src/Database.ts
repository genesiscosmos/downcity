/** SQLite Federation Database Adapter。 */

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
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
import { getTableColumns, getTableName } from "drizzle-orm";
import { SQLiteCoordinator } from "./SQLiteCoordinator.js";
import type { DatabaseOptions } from "./types/DatabaseOptions.js";

/** 使用 better-sqlite3 的本地 Federation Database。 */
export class Database extends CityDatabase {
  private readonly client: BetterSqlite3.Database;
  private readonly coordinator = new SQLiteCoordinator();

  constructor(options: DatabaseOptions) {
    const filename = String(options?.filename ?? "").trim();
    if (!filename) throw new TypeError("SQLite Database filename is required");
    const client = new BetterSqlite3(filename);
    if (filename !== ":memory:" && options.wal !== false) client.pragma("journal_mode = WAL");
    const drizzle_database = drizzle(client) as unknown as DrizzleDatabase;
    super({ schema_id: "sqlite", drizzle: drizzle_database });
    this.client = client;
  }

  protected on_table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow> {
    return new TableApi(this.drizzle, schema, {
      execute: (handler) => this.coordinator.run(handler),
    }) as unknown as CityTableApi<TRow>;
  }

  protected async on_ensure_table(schema: FederationTableSchema): Promise<void> {
    const ddl = build_create_table_sql(schema);
    if (ddl) this.client.exec(ddl);
  }

  protected async on_execute_ddl(statement: string): Promise<void> {
    this.client.exec(statement);
  }

  protected async on_query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>> {
    return await this.coordinator.run(async () => {
      const prepared = this.client.prepare(statement.sql);
      if (prepared.reader) {
        const rows = prepared.all(...statement.params) as TRow[];
        return { rows: rows.map((row) => ({ ...row })), changes: 0 };
      }
      const result = prepared.run(...statement.params);
      return { rows: [], changes: Number(result.changes ?? 0) };
    });
  }

  protected async on_atomic(
    statements: DatabaseStatement[],
  ): Promise<DatabaseMutationResult[]> {
    return await this.coordinator.run(async () => {
      const execute = this.client.transaction((commands: DatabaseStatement[]) =>
        commands.map((command) => {
          const result = this.client.prepare(command.sql).run(...command.params);
          return { changes: Number(result.changes ?? 0) };
        }));
      return execute(statements);
    });
  }

  protected async on_transaction<TResult>(
    handler: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return await this.coordinator.run(async () => {
      this.client.exec("BEGIN IMMEDIATE");
      try {
        const result = await handler({
          table: <TRow extends Record<string, unknown>>(schema: FederationTableSchema) =>
            new TableApi(this.drizzle, schema) as unknown as CityTableApi<TRow>,
        });
        this.client.exec("COMMIT");
        return result;
      } catch (error) {
        this.client.exec("ROLLBACK");
        throw error;
      }
    });
  }

  protected async on_dispose(): Promise<void> {
    this.client.close();
  }
}

/** 根据 SQLite Drizzle Schema 生成建表语句。 */
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

/** 安全引用 SQLite 标识符。 */
function quote_identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
