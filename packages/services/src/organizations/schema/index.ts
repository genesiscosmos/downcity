/** Organizations Service 数据库声明统一出口。 */

import type { ServiceDatabaseSchemas } from "@downcity/city";
import { pg_organization_tables, pg_organizations_ddl } from "./postgres.js";
import { sqlite_organization_tables, sqlite_organizations_ddl } from "./sqlite.js";

/** Federation 根据当前方言选择的 Organizations Service 数据库声明。 */
export const organization_database_schemas: ServiceDatabaseSchemas = {
  sqlite: {
    tables: sqlite_organization_tables,
    ddl: sqlite_organizations_ddl,
  },
  postgresql: {
    tables: pg_organization_tables,
    ddl: pg_organizations_ddl,
  },
};

export {
  sqlite_organization_join_requests,
  sqlite_organization_memberships,
  sqlite_organization_owner_slots,
  sqlite_organizations,
} from "./sqlite.js";

export {
  pg_organization_join_requests,
  pg_organization_memberships,
  pg_organization_owner_slots,
  pg_organizations,
} from "./postgres.js";
