/**
 * 显式部署迁移：删除 Bureau 运行依赖，保留旧来源事实与全部业务记录。
 *
 * 本模块没有命令行入口，也不被服务启动导入。部署者必须在维护窗口备份数据库、
 * 停止旧版本写入后，显式传入 Downtown Database Adapter 调用迁移。仅支持 SQLite
 * 与 PostgreSQL；所有 DDL、归档和完成标记通过 Adapter.atomic 在同一事务提交。
 * 失败自动回滚，修正原因后可重试；已提交迁移再次执行返回 false。
 *
 * 用户、密钥、余额、流水、组织成员、申请、任务及正在完成的登录事务原样保留。
 * 旧 bureau_id 从不推断成 city_id：来源映射存到迁移事实表，现有任务和用量的
 * city_id 保持 NULL。旧 Bureau 私有组织关闭新申请，Downtown 范围保留审核申请。
 */

const migration_id = "20261111_city_sources_without_bureau";
const marker_table = "downcity_schema_migrations";
const source_table = "downcity_legacy_source_facts";

/** 只读生成事务计划；不创建连接、不访问默认数据库、不执行迁移。 */
export async function plan_city_source_migration(database) {
  if (!["sqlite", "postgresql"].includes(database.schema_id)) throw new TypeError("Unsupported migration dialect");
  const columns = async (table) => {
    const result = database.schema_id === "sqlite"
      ? await database.query({ sql: `PRAGMA table_info("${table}")`, params: [] })
      : await database.query({ sql: "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", params: [table] });
    return new Set(result.rows.map((row) => String(row.name)));
  };
  if ((await columns(marker_table)).has("migration_id")) {
    const marker = await database.query({ sql: `SELECT migration_id FROM ${marker_table} WHERE migration_id = ?`, params: [migration_id] });
    if (marker.rows.length) return [];
  }
  const plan = [];
  const add = (sql, params = []) => plan.push({ sql, params });
  add(`CREATE TABLE IF NOT EXISTS ${marker_table} (migration_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL)`);
  add(`CREATE TABLE IF NOT EXISTS ${source_table} (table_name TEXT NOT NULL, record_id TEXT NOT NULL, bureau_id TEXT, scope_type TEXT, PRIMARY KEY (table_name, record_id))`);
  for (const [table, key] of [
    ["async_jobs", "job_id"],
    ["service_ai_usage_records", "usage_id"],
    ["service_feedback_messages", "feedback_id"],
    ["service_usage_events", "event_id"],
  ]) {
    const fields = await columns(table);
    if (!fields.size) continue;
    if (fields.has("bureau_id")) {
      add(`INSERT INTO ${source_table} (table_name, record_id, bureau_id) SELECT ?, "${key}", bureau_id FROM "${table}" WHERE 1 = 1 ON CONFLICT (table_name, record_id) DO NOTHING`, [table]);
      if (!fields.has("city_id")) add(`ALTER TABLE "${table}" ADD COLUMN city_id TEXT`);
      add(`ALTER TABLE "${table}" DROP COLUMN bureau_id`);
    }
  }
  // 未完成结算持有整条用量记录；保存原始负载后移除旧归属字段，保留租约和计费幂等键。
  if ((await columns("service_ai_settlement_jobs")).has("payload_json")) {
    const jobs = await database.query({ sql: "SELECT usage_id, payload_json FROM service_ai_settlement_jobs", params: [] });
    for (const job of jobs.rows) {
      const payload = JSON.parse(job.payload_json);
      if (!payload?.record || !Object.hasOwn(payload.record, "bureau_id")) continue;
      add("CREATE TABLE IF NOT EXISTS downcity_legacy_settlement_payloads (usage_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)");
      add("INSERT INTO downcity_legacy_settlement_payloads (usage_id, payload_json) VALUES (?, ?) ON CONFLICT (usage_id) DO NOTHING", [job.usage_id, job.payload_json]);
      delete payload.record.bureau_id;
      payload.record.city_id ??= null;
      add("UPDATE service_ai_settlement_jobs SET payload_json = ? WHERE usage_id = ?", [JSON.stringify(payload), job.usage_id]);
    }
  }
  const organization_fields = await columns("service_organizations");
  if (organization_fields.has("scope_type")) {
    add(`INSERT INTO ${source_table} (table_name, record_id, bureau_id, scope_type) SELECT 'service_organizations', organization_id, scope_bureau_id, scope_type FROM service_organizations WHERE 1 = 1 ON CONFLICT (table_name, record_id) DO NOTHING`);
    if (database.schema_id === "sqlite") {
      // SQLite 跨列 CHECK 不能原地删除；独占迁移连接中暂关即时外键，提交前完整校验。
      add(`CREATE TABLE service_organizations_city_source (
        organization_id TEXT PRIMARY KEY, name TEXT NOT NULL,
        join_policy TEXT NOT NULL CHECK (join_policy IN ('closed', 'approval')),
        state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT NOT NULL
      )`);
      add(`INSERT INTO service_organizations_city_source SELECT organization_id, name,
        CASE WHEN scope_type = 'downtown' THEN 'approval' ELSE 'closed' END,
        state, created_by, created_at, updated_at, archived_at FROM service_organizations`);
      add("DROP TABLE service_organizations");
      add("ALTER TABLE service_organizations_city_source RENAME TO service_organizations");
    } else {
      if (!organization_fields.has("join_policy")) add("ALTER TABLE service_organizations ADD COLUMN join_policy TEXT NOT NULL DEFAULT 'closed'");
      add("UPDATE service_organizations SET join_policy = CASE WHEN scope_type = 'downtown' THEN 'approval' ELSE 'closed' END");
      add("ALTER TABLE service_organizations DROP COLUMN scope_bureau_id");
      add("ALTER TABLE service_organizations DROP COLUMN scope_type");
      add("ALTER TABLE service_organizations ADD CONSTRAINT service_organizations_join_policy_check CHECK (join_policy IN ('closed', 'approval'))");
    }
  }
  // 现行登录事务保留 phase/state/PKCE/幂等交换材料，只删除不再消费的 Bureau 字段。
  const login_table = "service_accounts_login_flows_v4";
  if ((await columns(login_table)).has("bureau_id")) {
    add(`INSERT INTO ${source_table} (table_name, record_id, bureau_id) SELECT ?, login_id, bureau_id FROM ${login_table} WHERE 1 = 1 ON CONFLICT (table_name, record_id) DO NOTHING`, [login_table]);
    add(`ALTER TABLE ${login_table} DROP COLUMN bureau_id`);
  }
  // 机器凭据与产品注册数据不再进入运行 schema，原始数据单独保留供迁移审计。
  for (const table of ["downtown_bureaus", "downtown_bureau_servers", "downtown_bureau_tokens"]) {
    if (!(await columns(table)).size) continue;
    const archived_table = `archived_20261111_${table}`;
    if ((await columns(archived_table)).size) throw new Error(`Migration archive already exists: ${archived_table}`);
    add(`ALTER TABLE "${table}" RENAME TO "${archived_table}"`);
  }
  if (database.schema_id === "sqlite") {
    add("CREATE TEMP TABLE downcity_migration_fk_guard (violations INTEGER CHECK (violations = 0))");
    add("INSERT INTO downcity_migration_fk_guard SELECT COUNT(*) FROM pragma_foreign_key_check");
    add("DROP TABLE downcity_migration_fk_guard");
  }
  add(`INSERT INTO ${marker_table} (migration_id, completed_at) VALUES (?, ?)`,  [migration_id, new Date().toISOString()]);
  return plan;
}

/** 维护窗口显式执行；Adapter 负责事务回滚，不触及 Downtown ID、签名密钥或用户撤销状态。 */
export async function migrate_city_sources(database) {
  const plan = await plan_city_source_migration(database);
  if (!plan.length) return false;
  if (database.schema_id !== "sqlite") {
    await database.atomic(plan);
    return true;
  }
  // 此处必须使用维护窗口的独占连接，不能与业务共用 Adapter 或存在嵌套事务。
  const setting = await database.query({ sql: "PRAGMA foreign_keys", params: [] });
  const enabled = setting.rows[0]?.foreign_keys === 1;
  await database.query({ sql: "PRAGMA foreign_keys = OFF", params: [] });
  try {
    await database.atomic(plan);
    return true;
  } finally {
    await database.query({ sql: `PRAGMA foreign_keys = ${enabled ? "ON" : "OFF"}`, params: [] });
  }
}
