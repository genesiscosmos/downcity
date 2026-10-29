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
import { UserTokenRevocationStore } from "./auth/user-token-revocation-store.js";
import type { UserTokenRevocationRecord } from "./auth/user-token-schema.js";
import { randomSecret } from "../utils/helpers.js";
import { initialize_service, prepare_service_database, type Service } from "../service/service.js";
import { measure_startup } from "./startup-timing.js";
import type { FederationStartupTiming } from "./types.js";
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
  /** 是否执行部署阶段 schema、数据修复与引导。 */
  prepare_database: boolean;
  /** 可选的分阶段启动观测。 */
  on_startup_timing?: (event: FederationStartupTiming) => void;
}): Promise<FederationInitState> {
  const { runtime, services, require_ready } = params;
  const { database, env, builtinTables } = runtime;
  const { table_map, service_databases } = collect_database_tables(runtime, services);
  if (params.prepare_database) {
    await measure_startup("schema", async () => {
      await prepare_tables(database, table_map, service_databases);
      await assert_bureau_server_records(database);
    }, params.on_startup_timing);
  }

  const env_table = table_map.get("env");
  if (!env_table) throw new Error("Federation env table is not initialized");
  const env_store = new EnvStore(env_table as CityTableApi<EnvEntry>);
  await measure_startup("env", () => env.attachStore(env_store), params.on_startup_timing);
  if (!params.prepare_database && env.get("DOWNCITY_DATABASE_PREPARATION_VERSION") !== "1") {
    throw new Error("Federation database preparation is required before starting this release");
  }

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

  if (params.prepare_database) await bootstrap_default_keys(env);
  if (!env.get("BETTER_AUTH_SECRET")) {
    throw new Error("Federation database is not prepared: missing BETTER_AUTH_SECRET");
  }

  const federation_id = env.get("DOWNCITY_FEDERATION_ID");
  if (!federation_id) throw new Error("DOWNCITY_FEDERATION_ID is required");
  const auth_key_table = table_map.get("federation_auth_keys");
  if (!auth_key_table) throw new Error("Federation auth key table is not initialized");
  const key_store = new FederationKeyStore(
    auth_key_table as CityTableApi<FederationAuthKeyRecord>,
  );
  await measure_startup("auth_keys", async () => {
    if (params.prepare_database) {
      await initialize_federation_auth_keys(key_store, database);
    } else if (!await key_store.get_active_key()) {
      throw new Error("Federation database is not prepared: missing active signing key");
    }
  }, params.on_startup_timing);
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
  const revocation_table = table_map.get("federation_user_token_revocations");
  if (!revocation_table) throw new Error("User Token revocation table is not initialized");
  const user_token_revocations = new UserTokenRevocationStore(
    revocation_table as CityTableApi<UserTokenRevocationRecord>,
    database,
  );
  if (params.prepare_database) {
    await database.execute_ddl('CREATE INDEX IF NOT EXISTS federation_user_token_revocations_expiry_idx ON "federation_user_token_revocations" ("expires_at")');
  }
  const authenticator = new Authenticator(
    env,
    require_ready,
    token_authority,
    key_store,
    bureau_token_store,
    admin_store,
    user_token_revocations,
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
    await measure_startup(`service:${service.id}`, async () => {
      if (params.prepare_database) await prepare_service_database(service);
      await initialize_service(service);
    }, params.on_startup_timing);
  }

  if (params.prepare_database) {
    await env.upsert({ key: "DOWNCITY_DATABASE_PREPARATION_VERSION", value: "1" });
  }

  return {
    database,
    table_map,
    bureau_store,
    authenticator,
    admin_store,
  };
}

/** 只创建迁移目标表，不生成任何身份、密钥或配置，也不执行业务数据修复。 */
export async function prepare_federation_schema(runtime: Runtime, services: Service[]): Promise<void> {
  const { table_map, service_databases } = collect_database_tables(runtime, services);
  await prepare_tables(runtime.database, table_map, service_databases);
}

/** 统一选择方言并收集内置与业务表，保证迁移和在线启动使用同一声明。 */
function collect_database_tables(runtime: Runtime, services: Service[]): {
  /** 按逻辑名称索引的表访问对象。 */
  table_map: Map<string, CityTableApi>;
  /** 当前方言的业务数据库声明。 */
  service_databases: ServiceDatabaseSchema[];
} {
  const service_databases = resolve_service_databases(services, runtime.database.schema_id);
  const table_map = new Map<string, CityTableApi>();
  for (const [name, schema] of Object.entries(runtime.builtinTables)) {
    table_map.set(name, runtime.database.table(schema));
  }
  for (const [name, schema] of Object.entries(collect_service_schemas(services))) {
    table_map.set(name, runtime.database.table(schema));
  }
  return { table_map, service_databases };
}

/** 执行幂等的结构准备，不写业务数据。 */
async function prepare_tables(
  database: Database,
  table_map: Map<string, CityTableApi>,
  service_databases: ServiceDatabaseSchema[],
): Promise<void> {
  for (const schema of service_databases) {
    for (const ddl of schema.ddl ?? []) await database.execute_ddl(ddl);
  }
  for (const table of table_map.values()) await database.ensure_table(table.schema);
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
    if (!service.database_schemas) continue;
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
