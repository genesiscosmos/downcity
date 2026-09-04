/** 本地数据库 Adapter 的公开类型。 */

/** 一条带位置参数的 SQL 语句。 */
export interface LocalDatabaseStatement {
  /** 需要执行的 SQL 文本。 */
  sql: string;

  /** 依照 SQL 占位符顺序绑定的参数。 */
  params?: readonly LocalDatabaseValue[];
}

/** 数据库参数允许的基础值。 */
export type LocalDatabaseValue = string | number | bigint | Uint8Array | null;

/** 数据库写入语句的原始执行结果。 */
export interface LocalPreparedMutationResult {
  /** 当前语句修改的数据行数量。 */
  changes: number | bigint;

  /** 当前插入语句生成的整数主键。 */
  last_insert_rowid: number | bigint;
}

/** 可复用参数化语句的数据库无关协议。 */
export interface LocalPreparedStatement {
  /** 执行查询并返回第一行；没有结果时返回 `undefined`。 */
  get(...params: LocalDatabaseValue[]): Record<string, unknown> | undefined;

  /** 执行查询并返回全部数据行。 */
  all(...params: LocalDatabaseValue[]): Record<string, unknown>[];

  /** 执行写入并返回修改数量和生成主键。 */
  run(...params: LocalDatabaseValue[]): LocalPreparedMutationResult;
}

/** 数据库查询结果。 */
export interface LocalDatabaseQueryResult<TRow extends Record<string, unknown>> {
  /** 查询返回的结构化数据行。 */
  rows: TRow[];
}

/** 数据库写入结果。 */
export interface LocalDatabaseMutationResult {
  /** 当前语句修改的数据行数量。 */
  changes: number;

  /** 当前插入语句生成的整数主键；没有时省略。 */
  last_insert_rowid?: number | bigint;
}

/** 事务中可用的数据库原语。 */
export interface LocalDatabaseTransaction {
  /** 在当前事务内执行查询。 */
  query<TRow extends Record<string, unknown>>(
    statement: LocalDatabaseStatement,
  ): LocalDatabaseQueryResult<TRow>;

  /** 在当前事务内执行写入。 */
  execute(statement: LocalDatabaseStatement): LocalDatabaseMutationResult;
}

/** 本地 SQLite Adapter 构造参数。 */
export interface LocalDatabaseOptions {
  /** SQLite 数据库文件绝对路径。 */
  filename: string;

  /** 是否启用 WAL；默认启用。 */
  wal?: boolean;
}
