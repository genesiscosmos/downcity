/**
 * Edge Federation 的 Cloudflare Worker binding 类型。
 */

/** Worker 运行时注入的资源。 */
export interface Env {
  /** Federation 持久化状态使用的 D1 数据库。 */
  DB: D1Database;
}
