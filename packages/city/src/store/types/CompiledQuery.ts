/** Drizzle Query 编译结果类型。 */

/** 已编译的方言 SQL。 */
export interface CompiledQuery {
  /** 使用当前方言占位符生成的 SQL。 */
  sql: string;
  /** 已经过 Drizzle 编码的 SQL 参数。 */
  params: unknown[];
}
