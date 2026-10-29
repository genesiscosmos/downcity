/** feedback 服务按数据库 schema_id 选择表声明。 */
import type { ServiceDatabaseSchemas } from "@downcity/federation";
import { feedbackMessages } from "./schema.js";
import { pg_feedback_messages } from "./postgres-schema.js";

/** SQLite/D1 与 PostgreSQL 共用的领域表映射。 */
export const feedback_database_schemas: ServiceDatabaseSchemas = {
  sqlite: { tables: {
    messages: feedbackMessages
  } },
  postgresql: { tables: {
    messages: pg_feedback_messages
  } },
};
