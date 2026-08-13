/**
 * Federation 初始化模块。
 *
 * 负责组装表、执行建表、挂载 env store、初始化 authenticator，
 * 并把 runtime 依赖注入到各个 service。
 */

import type { CityTableApi } from "../store/table-api.js";
import type { Database } from "../database/Database.js";
import { DatabaseSchemaError } from "../types/database/DatabaseError.js";
import { EnvStore } from "../service/env/env-store.js";
import { BureauStore } from "../service/bureaus/bureau-store.js";
import { Authenticator } from "./auth/authenticator.js";
import { FederationKeyStore } from "./auth/federation-key-store.js";
import { CREATE_FEDERATION_ACTIVE_AUTH_KEY_INDEX_SQL } from "./auth/key-schema.js";
import { UserTokenAuthority } from "./auth/user-token-authority.js";
import { BureauTokenStore } from "./auth/bureau-token-store.js";
import { FederationAdminStore } from "./auth/admin-store.js";
import { randomSecret } from "../utils/helpers.js";
import { initialize_service, type Service } from "../service/service.js";
import {
  InstallableService,
  install_service,
  type ServiceDatabaseSchema,
} from "../service/installable-service.js";
import type { CityUserSchemaInput } from "../store/types.js";
import type { Runtime } from "./runtime.js";
import type {
  BureauIdentityRecord,
  BureauRecord,
  BureauServerRecord,
} from "../types/Bureau.js";
import type { EnvEntry } from "../service/env/types.js";
import type { FederationAuthKeyRecord } from "./auth/types.js";
import type {
  FederationAdministratorRecord,
  FederationAdminSessionRecord,
} from "./auth/types.js";
import type { BureauTokenRecord } from "../types/Bureau.js";
import { assert_bureau_server_records } from "./schema-validation.js";

/**
 * Federation 初始化后的内部状态。
 */
export interface FederationInitState {
  /** 初始化后的 database */
  database: Database;
  /** 所有表 API 映射 */
  table_map: Map<string, CityTableApi>;
  /** Bureau 身份 Store。 */
  bureau_store: BureauStore;
  /** 鉴权器 */
  authenticator: Authenticator;
  /** Federation 管理员身份与会话 Store。 */
  admin_store: FederationAdminStore;
}

/**
 * 执行 Federation 初始化。
 */
export async function initialize_federation(params: {
  /** runtime 能力 */
  runtime: Runtime;
  /** 已注册服务 */
  services: Service[];
  /** Federation ready 后读取 Bureau Store 的回调。 */
  require_ready: () => Promise<{ bureau: { get(id: string): Promise<BureauRecord | undefined> } }>;
  /** Federation queue facade */
  queue?: unknown;
}): Promise<FederationInitState> {
  const { runtime, services, require_ready } = params;
  const { database, env, builtinTables } = runtime;

  const service_databases = resolve_service_databases(services, database.schema_id);
  const user_schema = collect_service_schemas(services);
  const table_map = new Map<string, CityTableApi>();
  table_map.set("bureaus", database.table(builtinTables.bureaus));
  table_map.set("bureau_servers", database.table(builtinTables.bureau_servers));
  table_map.set("env", database.table(builtinTables.env));
  table_map.set(
    "federation_auth_keys",
    database.table(builtinTables.federation_auth_keys),
  );
  table_map.set("bureau_tokens", database.table(builtinTables.bureau_tokens));
  table_map.set(
    "federation_administrators",
    database.table(builtinTables.federation_administrators),
  );
  table_map.set(
    "federation_admin_sessions",
    database.table(builtinTables.federation_admin_sessions),
  );

  for (const [name, table] of Object.entries(user_schema)) {
    table_map.set(name, database.table(table));
  }

  for (const schema of service_databases) {
    for (const ddl of schema.ddl ?? []) {
      await database.execute_ddl(ddl);
    }
  }
  for (const table of table_map.values()) {
    await database.ensure_table(table.schema);
  }
  await assert_bureau_server_records(database);

  const env_table = table_map.get("env");
  if (!env_table) throw new Error("Federation env table is not initialized");
  const env_store = new EnvStore(env_table as CityTableApi<EnvEntry>);
  await env.attachStore(env_store);

  const bureaus_table = table_map.get("bureaus");
  if (!bureaus_table) throw new Error("Federation Bureau table is not initialized");
  const bureau_servers_table = table_map.get("bureau_servers");
  if (!bureau_servers_table) throw new Error("Federation Bureau Server table is not initialized");
  const bureau_store = new BureauStore({
    database,
    bureau_schema: builtinTables.bureaus,
    server_schema: builtinTables.bureau_servers,
    bureau_table: bureaus_table as CityTableApi<BureauIdentityRecord>,
    server_table: bureau_servers_table as CityTableApi<BureauServerRecord>,
  });

  const configured_base_url = env.get("DOWNCITY_FEDERATION_BASE_URL")
    ?? env.get("BETTER_AUTH_URL")
    ?? runtime.baseURL
    ?? "http://localhost";

  await bootstrap_default_keys(env);

  const federation_id = env.get("DOWNCITY_FEDERATION_ID");
  if (!federation_id) throw new Error("DOWNCITY_FEDERATION_ID is required");
  const auth_key_table = table_map.get("federation_auth_keys");
  if (!auth_key_table) throw new Error("Federation auth key table is not initialized");
  const key_store = new FederationKeyStore(
    auth_key_table as CityTableApi<FederationAuthKeyRecord>,
  );
  await initialize_federation_auth_keys(key_store, database);
  const token_authority = new UserTokenAuthority(
    key_store,
    `urn:downcity:federation:${federation_id}`,
  );
  const bureau_token_table = table_map.get("bureau_tokens");
  if (!bureau_token_table) throw new Error("Federation Bureau Token table is not initialized");
  const bureau_token_store = new BureauTokenStore(
    bureau_token_table as CityTableApi<BureauTokenRecord>,
  );
  const administrator_table = table_map.get("federation_administrators");
  if (!administrator_table) throw new Error("Federation administrator table is not initialized");
  const admin_session_table = table_map.get("federation_admin_sessions");
  if (!admin_session_table) throw new Error("Federation admin session table is not initialized");
  const admin_store = new FederationAdminStore(
    administrator_table as CityTableApi<FederationAdministratorRecord>,
    admin_session_table as CityTableApi<FederationAdminSessionRecord>,
  );
  const authenticator = new Authenticator(
    env,
    require_ready,
    token_authority,
    key_store,
    bureau_token_store,
    admin_store,
  );

  for (const service of services) {
    service._authenticator = authenticator;
    service._env = env;
    service._bureauStore = bureau_store;
    service._bureauTokenStore = bureau_token_store;
    service._baseURL = configured_base_url ?? runtime.baseURL;
    service._queue = params.queue as never;
    service._storage = runtime.storage;
    service._database = database.service_context();
    service._tables = Object.fromEntries(
      Object.keys(service.tables ?? {}).map((name) => [
        name,
        table_map.get(`${service.id}.${name}`)!,
      ]),
    );
    if (service instanceof InstallableService) {
      install_service(service, database);
    }
    await initialize_service(service);
  }

  return {
    database,
    table_map,
    bureau_store,
    authenticator,
    admin_store,
  };
}

/**
 * 根据 Federation 当前方言选择 Service 数据库声明。
 *
 * 方言声明在建表和安装 Route 前完成，保证 Table API、DDL 与 Repository 使用
 * 同一组表对象。
 */
function resolve_service_databases(
  services: Service[],
  schema_id: string,
): ServiceDatabaseSchema[] {
  const resolved: ServiceDatabaseSchema[] = [];
  for (const service of services) {
    if (!(service instanceof InstallableService) || !service.database_schemas) continue;
    const schema = service.database_schemas[schema_id];
    if (!schema) {
      throw new DatabaseSchemaError(service.id, schema_id);
    }
    service.tables = schema.tables;
    resolved.push(schema);
  }
  return resolved;
}

/**
 * 收集所有 service 声明的业务表。
 */
function collect_service_schemas(services: Service[]): CityUserSchemaInput {
  const collected: CityUserSchemaInput = {};
  for (const service of services) {
    const tables = service.tables ?? (service as { schema?: Record<string, unknown> }).schema;
    if (!tables) continue;
    for (const [name, table] of Object.entries(tables)) {
      const scoped_name = `${service.id}.${name}`;
      if (collected[scoped_name]) {
        throw new Error(`Duplicate schema table "${scoped_name}" from services: ${service.id}`);
      }
      collected[scoped_name] = table as never;
    }
  }
  return collected;
}

/**
 * 确保 Federation 系统级 env key 存在。
 *
 * 关键说明（中文）
 * - 系统密钥也统一走 Federation env 表托管
 * - 缺失时自动生成，避免宿主环境额外配置负担
 */
async function bootstrap_default_keys(
  env: {
    get(key: string): string | undefined;
    ensure(input: { key: string; value: string }): Promise<unknown>;
  },
): Promise<void> {
  const federation_id = env.get("DOWNCITY_FEDERATION_ID") || `fed_${randomSecret(16)}`;
  if (!env.get("DOWNCITY_FEDERATION_ID")) {
    await env.ensure({ key: "DOWNCITY_FEDERATION_ID", value: federation_id });
  }

  const better_auth_secret = env.get("BETTER_AUTH_SECRET") || `better_auth_${randomSecret()}${randomSecret()}`;
  if (!env.get("BETTER_AUTH_SECRET")) {
    await env.ensure({ key: "BETTER_AUTH_SECRET", value: better_auth_secret });
  }
}

/**
 * 初始化 Federation user token Key Ring 的数据库不变量。
 *
 * 关键说明（中文）
 * - 建立 partial unique index 前统一收敛异常的多 active 数据。
 * - 新数据库建立索引后才生成首把 key，所有 Worker isolate 通过数据库约束竞争唯一胜者。
 * - 重试覆盖滚动发布期间旧实例恰好插入 active key 的极短窗口。
 */
async function initialize_federation_auth_keys(
  key_store: FederationKeyStore,
  database: Database,
): Promise<void> {
  const max_attempts = 3;
  let last_error: unknown;
  for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
    await key_store.reconcile_active_keys();
    try {
      await database.execute_ddl(CREATE_FEDERATION_ACTIVE_AUTH_KEY_INDEX_SQL);
      await key_store.ensure_active_key();
      return;
    } catch (error) {
      last_error = error;
    }
  }
  throw last_error;
}
