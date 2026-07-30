/** Federation Database 稳定错误模块。 */

/** Database 已释放后仍被调用。 */
export class DatabaseClosedError extends Error {
  constructor() {
    super("Database has been disposed");
    this.name = "DatabaseClosedError";
  }
}

/** Service 没有声明当前 Adapter 所需的 Schema。 */
export class DatabaseSchemaError extends Error {
  constructor(service_id: string, schema_id: string) {
    super(`${service_id} service does not support database schema ${schema_id}`);
    this.name = "DatabaseSchemaError";
  }
}

/** 乐观事务在最大尝试次数内未能提交。 */
export class DatabaseTransactionConflictError extends Error {
  constructor(options: { cause?: unknown } = {}) {
    super("Database transaction conflict retry exhausted", options);
    this.name = "DatabaseTransactionConflictError";
  }
}
