/** Cloudflare D1 乐观事务使用的内部类型。 */

/** 可由 D1 batch 执行的预编译语句。 */
export interface D1PreparedStatement {
  /** 绑定 SQL 参数并返回可执行语句。 */
  bind(...params: unknown[]): D1PreparedStatement;
  /** 执行写入或 DDL 语句。 */
  run?(): Promise<unknown>;
}

/** D1 batch 单条语句的执行结果。 */
export interface D1BatchResult {
  /** D1 返回的写入元数据。 */
  meta?: { changes?: number };
}

/** 已编译的方言 SQL。 */
export interface CompiledQuery {
  /** 使用方言占位符生成的 SQL。 */
  sql: string;
  /** 已经过 Drizzle 编码的 SQL 参数。 */
  params: unknown[];
}

/** 一次读取的数据库快照。 */
export interface D1ReadSnapshot {
  /** 读取的物理表名。 */
  table_name: string;
  /** 原始等值查询条件。 */
  where: Record<string, unknown>;
  /** 查询返回的完整行。 */
  rows: Record<string, unknown>[];
}
