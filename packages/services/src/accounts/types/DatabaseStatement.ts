/** Accounts 参数化数据库 Statement 类型。 */

/** 已绑定参数的 Accounts 数据库 Statement。 */
export interface AccountsBoundStatement {
  /** 读取第一条记录。 */
  first(): Promise<Record<string, unknown> | null>;
  /** 读取全部记录。 */
  all(): Promise<{ results: Record<string, unknown>[] }>;
  /** 执行写命令。 */
  run(): Promise<unknown>;
}

/** 等待绑定参数的 Accounts 数据库 Statement。 */
export interface AccountsPreparedStatement {
  /** 按 SQL 占位符顺序绑定参数。 */
  bind(...params: unknown[]): AccountsBoundStatement;
}
