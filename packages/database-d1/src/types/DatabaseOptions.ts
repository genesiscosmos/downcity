/** D1 Database 构造参数类型。 */

/** Cloudflare D1 Database Adapter 构造参数。 */
export interface DatabaseOptions {
  /** Cloudflare Worker 注入的 D1 binding。 */
  binding: D1Database;
  /** 乐观事务最大尝试次数，默认 8。 */
  max_transaction_attempts?: number;
}
