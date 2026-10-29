/** Service SQL 参数绑定；SQL 结构由各领域模块显式选择方言。 */

import type { DatabaseStatement, ServiceDatabaseContext } from "@downcity/federation";

/** 将服务内部的问号参数转换为 PostgreSQL 编号参数，保留引号内的文本和标识符。 */
export function bind_statement(schema_id: string, statement: DatabaseStatement): DatabaseStatement {
  if (schema_id !== "postgresql") return statement;
  let parameter_index = 0;
  const sql = statement.sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/gu, (token) =>
    token === "?" ? `$${++parameter_index}` : token,
  );
  if (parameter_index !== statement.params.length) {
    throw new TypeError("Service SQL parameter count does not match bound values");
  }
  return { sql, params: statement.params };
}

/** 为使用显式 Service SQL 的领域对象创建方言感知入口，Drizzle 实例保持原样。 */
export function service_sql_database(database: ServiceDatabaseContext): ServiceDatabaseContext {
  return {
    schema_id: database.schema_id,
    drizzle: database.drizzle,
    query: (statement) => database.query(bind_statement(database.schema_id, statement)),
    atomic: (statements) => database.atomic(statements.map((statement) => bind_statement(database.schema_id, statement))),
  };
}
