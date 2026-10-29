/** PostgreSQL Database 构造参数类型。 */

/** PostgreSQL Database Adapter 构造参数。 */
export interface DatabaseOptions {
  /** PostgreSQL 连接 URL。 */
  url: string;
  /** 当前执行实例最多保留的连接数；Worker 建议设为 1，由 Hyperdrive 维护上游连接池。 */
  max_connections?: number;
  /** 空闲连接关闭时间，单位秒，默认 20。 */
  idle_timeout_seconds?: number;
  /** 建立数据库连接的超时时间，单位秒，默认 10。 */
  connect_timeout_seconds?: number;
  /** 是否使用服务端预处理语句，默认关闭，适配事务连接池与 Hyperdrive。 */
  prepare_statements?: boolean;
}
