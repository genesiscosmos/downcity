/**
 * Credits 原子数据库命令类型。
 */

/** 一条待原子执行的 SQL 命令。 */
export interface CreditsRawCommand {
  /** SQL 文本。 */
  sql: string;
  /** SQL 绑定参数。 */
  params: unknown[];
}

/** 一条 SQL 命令的执行结果。 */
export interface CreditsRawRunResult {
  /** 受影响行数。 */
  changes: number;
}
