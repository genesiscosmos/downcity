/** accounts 服务按数据库 schema_id 选择表声明。 */
import type { ServiceDatabaseSchemas } from "@downcity/downtown";
import { userProfiles, authUsers, authSessions, authAccounts, authVerifications } from "./schema.js";
import { login_flows } from "./login-schema.js";
import { pg_user_profiles, pg_auth_users, pg_auth_sessions, pg_auth_accounts, pg_auth_verifications } from "./postgres-schema.js";
import { pg_login_flows } from "./postgres-login-schema.js";

/** SQLite/D1 与 PostgreSQL 共用的领域表映射。 */
export const accounts_database_schemas: ServiceDatabaseSchemas = {
  sqlite: { tables: {
    profile: userProfiles,
    auth_users: authUsers,
    auth_sessions: authSessions,
    auth_accounts: authAccounts,
    auth_verifications: authVerifications,
    login_flows: login_flows
  } },
  postgresql: { tables: {
    profile: pg_user_profiles,
    auth_users: pg_auth_users,
    auth_sessions: pg_auth_sessions,
    auth_accounts: pg_auth_accounts,
    auth_verifications: pg_auth_verifications,
    login_flows: pg_login_flows
  } },
};
