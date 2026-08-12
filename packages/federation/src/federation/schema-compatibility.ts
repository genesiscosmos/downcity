/**
 * Federation 身份 Schema 兼容性守卫。
 *
 * 新 Runtime 不读取旧 City 产品表，也不会把缺少 `bureau_id` 的历史机器凭证
 * 猜测绑定到任意 Bureau。检测到混合 Schema 时必须先执行显式数据迁移。
 */

import type { Database } from "../database/Database.js";

/** 在创建新表前拒绝不能满足当前身份模型的历史表。 */
export async function assert_federation_identity_schema(database: Database): Promise<void> {
  const schema = database.schema_id;
  if (schema === "sqlite") {
    await assert_sqlite_identity_schema(database);
    return;
  }
  if (schema === "postgresql") {
    await assert_postgresql_identity_schema(database);
  }
}

/** 检查 SQLite 与 D1 使用的身份表结构。 */
async function assert_sqlite_identity_schema(database: Database): Promise<void> {
  const legacy_cities = await database.query<{ name: string }>({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cities'",
    params: [],
  });
  if (legacy_cities.rows.length > 0) throw_migration_required("legacy cities table exists");

  const token_table = await database.query<{ name: string }>({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'federation_bureau_tokens'",
    params: [],
  });
  if (token_table.rows.length > 0) {
    const columns = await database.query<{ name: string }>({
      sql: "PRAGMA table_info(federation_bureau_tokens)",
      params: [],
    });
    if (!columns.rows.some((column) => column.name === "bureau_id")) {
      throw_migration_required("legacy Bureau Token records have no bureau_id");
    }
  }

  const bureau_tables = await database.query<{ name: string }>({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('federation_bureaus', 'federation_bureau_servers')",
    params: [],
  });
  const has_bureaus = bureau_tables.rows.some((row) => row.name === "federation_bureaus");
  const has_bureau_servers = bureau_tables.rows.some((row) => row.name === "federation_bureau_servers");
  if (has_bureaus) {
    const columns = await database.query<{ name: string }>({
      sql: "PRAGMA table_info(federation_bureaus)",
      params: [],
    });
    if (columns.rows.some((column) => column.name === "server_url")) {
      throw_migration_required("legacy Bureau records store server_url on the identity table");
    }
  }
  if (has_bureau_servers) {
    const columns = await database.query<{ name: string }>({
      sql: "PRAGMA table_info(federation_bureau_servers)",
      params: [],
    });
    if (!columns.rows.some((column) => column.name === "server_url")) {
      throw_migration_required("Bureau Server records have no server_url");
    }
  }
}

/** 检查 PostgreSQL 使用的身份表结构。 */
async function assert_postgresql_identity_schema(database: Database): Promise<void> {
  const tables = await database.query<{ table_name: string }>({
    sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('cities', 'federation_bureaus', 'federation_bureau_servers', 'federation_bureau_tokens')",
    params: [],
  });
  if (tables.rows.some((row) => row.table_name === "cities")) {
    throw_migration_required("legacy cities table exists");
  }
  if (tables.rows.some((row) => row.table_name === "federation_bureau_tokens")) {
    const columns = await database.query<{ column_name: string }>({
      sql: "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'federation_bureau_tokens'",
      params: [],
    });
    if (!columns.rows.some((column) => column.column_name === "bureau_id")) {
      throw_migration_required("legacy Bureau Token records have no bureau_id");
    }
  }

  const has_bureaus = tables.rows.some((row) => row.table_name === "federation_bureaus");
  const has_bureau_servers = tables.rows.some((row) => row.table_name === "federation_bureau_servers");
  if (has_bureaus) {
    const columns = await database.query<{ column_name: string }>({
      sql: "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'federation_bureaus'",
      params: [],
    });
    if (columns.rows.some((column) => column.column_name === "server_url")) {
      throw_migration_required("legacy Bureau records store server_url on the identity table");
    }
  }
  if (has_bureau_servers) {
    const columns = await database.query<{ column_name: string }>({
      sql: "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'federation_bureau_servers'",
      params: [],
    });
    if (!columns.rows.some((column) => column.column_name === "server_url")) {
      throw_migration_required("Bureau Server records have no server_url");
    }
  }
}

/** 在两张表完成创建后拒绝缺少一对一 Server 配置的历史 Bureau 数据。 */
export async function assert_bureau_server_records(database: Database): Promise<void> {
  const orphan_bureaus = await database.query<{ bureau_id: string }>({
    sql: "SELECT b.bureau_id FROM federation_bureaus b LEFT JOIN federation_bureau_servers s ON s.bureau_id = b.bureau_id WHERE s.bureau_id IS NULL LIMIT 1",
    params: [],
  });
  if (orphan_bureaus.rows.length > 0) {
    throw_migration_required(`Bureau Server record is missing for ${orphan_bureaus.rows[0].bureau_id}`);
  }
  const orphan_servers = await database.query<{ bureau_id: string }>({
    sql: "SELECT s.bureau_id FROM federation_bureau_servers s LEFT JOIN federation_bureaus b ON b.bureau_id = s.bureau_id WHERE b.bureau_id IS NULL LIMIT 1",
    params: [],
  });
  if (orphan_servers.rows.length > 0) {
    throw_migration_required(`Bureau identity is missing for Server ${orphan_servers.rows[0].bureau_id}`);
  }
}

/** 生成统一、可操作的迁移错误。 */
function throw_migration_required(reason: string): never {
  throw new Error(
    `Federation identity schema migration required: ${reason}. `
    + "Migrate Bureau identities and their required Server records, then re-register "
    + "any Bureau Token whose ownership cannot be established before startup.",
  );
}
