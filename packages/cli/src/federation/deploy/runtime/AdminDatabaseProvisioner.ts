/**
 * Federation 管理员数据库部署器。
 *
 * 管理员初始化与恢复属于 `fed deploy` 控制面：Local 直接事务写入 SQLite，Cloudflare
 * 通过 Wrangler 的远程 D1 权限执行临时 SQL 文件。Worker Runtime 不接收任何恢复变量。
 */

import BetterSqlite3 from "better-sqlite3";
import { parse as parse_dotenv } from "dotenv";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";
import { CliError } from "@/shared/CliError.js";
import type {
  FederationAdminDatabaseResult,
  FederationAdminDeploymentCredentials,
} from "@/federation/types/FederationAdminDeployment.js";

const OWNER_SLOT = "owner";

/** 直接事务写入 Local Federation 的 SQLite 管理员数据库。 */
export function provision_local_admin_database(
  project_dir: string,
  credentials: FederationAdminDeploymentCredentials,
): FederationAdminDatabaseResult {
  const database_path = resolve_local_database_path(project_dir);
  const database = new BetterSqlite3(database_path);
  try {
    database.exec(admin_schema_sql());
    const apply_credentials = database.transaction(() => {
      if (credentials.mode === "reset") {
        database.prepare(reset_administrator_sql()).run(database_values(credentials));
        database.prepare(revoke_sessions_sql()).run(new Date().toISOString());
      } else {
        database.prepare(initialize_administrator_sql()).run(database_values(credentials));
      }
    });
    apply_credentials();
    const current = database.prepare(
      "SELECT admin_id, provision_id FROM federation_administrators WHERE owner_slot = ? LIMIT 1",
    ).get(OWNER_SLOT) as { admin_id?: unknown; provision_id?: unknown } | undefined;
    const admin_id = String(current?.admin_id ?? "").trim();
    if (!admin_id) throw new Error("Administrator row was not created");
    return {
      admin_id,
      credentials_applied: String(current?.provision_id ?? "") === credentials.provision_id,
    };
  } catch (error) {
    throw new CliError({
      title: "Local administrator database update failed",
      note: error instanceof Error ? error.message : String(error),
      fix: `Check the SQLite database at ${database_path}.`,
    });
  } finally {
    database.close();
  }
}

/** 使用 Cloudflare 部署权限直接写入远程 D1 管理员数据库。 */
export async function provision_cloudflare_admin_database(params: {
  /** Federation 项目目录。 */
  project_dir: string;
  /** Cloudflare account id。 */
  account_id?: string;
  /** federation.json 声明的 D1 数据库名。 */
  database_name: string;
  /** 本次候选管理员凭证。 */
  credentials: FederationAdminDeploymentCredentials;
}): Promise<FederationAdminDatabaseResult> {
  const sql_dir = mkdtempSync(join(tmpdir(), "downcity-admin-d1-"));
  const sql_path = join(sql_dir, "administrator.sql");
  writeFileSync(sql_path, build_remote_admin_sql(params.credentials), { encoding: "utf8", mode: 0o600 });
  try {
    const output = await runCommand({
      label: params.credentials.mode === "reset"
        ? "Reset Federation administrator"
        : "Initialize Federation administrator",
      command: `pnpm exec wrangler d1 execute ${shell_quote(params.database_name)} --remote --file ${shell_quote(sql_path)} --json --yes`,
      cwd: params.project_dir,
      env: { CLOUDFLARE_ACCOUNT_ID: params.account_id },
      capture: true,
    });
    const current = find_admin_result(JSON.parse(output) as unknown);
    if (!current?.admin_id) {
      throw new Error("Wrangler completed without returning the administrator row");
    }
    return {
      admin_id: current.admin_id,
      credentials_applied: current.provision_id === params.credentials.provision_id,
    };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError({
      title: "Cloudflare administrator database update failed",
      note: error instanceof Error ? error.message : String(error),
      fix: `Check D1 database ${params.database_name} and the current Cloudflare account permission.`,
    });
  } finally {
    rmSync(sql_dir, { recursive: true, force: true });
  }
}

/** 解析 Local 模板使用的 SQLite 文件路径。 */
function resolve_local_database_path(project_dir: string): string {
  const env_path = join(project_dir, ".env");
  const entries = existsSync(env_path) ? parse_dotenv(readFileSync(env_path)) : {};
  const database_url = String(entries.DOWNCITY_FEDERATION_DATABASE_URL ?? "file:./data.sqlite").trim();
  if (!database_url.startsWith("file:")) {
    throw new CliError({
      title: "Local administrator reset requires SQLite",
      note: "DOWNCITY_FEDERATION_DATABASE_URL must use a file: SQLite URL.",
    });
  }
  const filename = database_url.slice("file:".length).trim();
  if (!filename) throw new CliError({ title: "Local SQLite database path is empty" });
  return isAbsolute(filename) ? filename : resolve(project_dir, filename);
}

/** 创建管理员与 Session 系统表。 */
function admin_schema_sql(): string {
  return `
CREATE TABLE IF NOT EXISTS federation_administrators (
  owner_slot TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  failed_attempts TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  provision_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS federation_administrators_admin_id
  ON federation_administrators(admin_id);
CREATE TABLE IF NOT EXISTS federation_admin_sessions (
  session_id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS federation_admin_sessions_token_hash
  ON federation_admin_sessions(token_hash);
`.trim();
}

/** 首次部署只在 owner 槽位为空时创建管理员。 */
function initialize_administrator_sql(): string {
  return `INSERT OR IGNORE INTO federation_administrators (
    owner_slot, admin_id, password_hash, status, failed_attempts, locked_until,
    provision_id, created_at, updated_at
  ) VALUES (
    @owner_slot, @admin_id, @password_hash, 'active', '0', '',
    @provision_id, @created_at, @updated_at
  )`;
}

/** 显式恢复时创建或覆盖固定 owner 管理员。 */
function reset_administrator_sql(): string {
  return `INSERT INTO federation_administrators (
    owner_slot, admin_id, password_hash, status, failed_attempts, locked_until,
    provision_id, created_at, updated_at
  ) VALUES (
    @owner_slot, @admin_id, @password_hash, 'active', '0', '',
    @provision_id, @created_at, @updated_at
  ) ON CONFLICT(owner_slot) DO UPDATE SET
    admin_id = excluded.admin_id,
    password_hash = excluded.password_hash,
    status = 'active',
    failed_attempts = '0',
    locked_until = '',
    provision_id = excluded.provision_id,
    updated_at = excluded.updated_at`;
}

/** 重置管理员后撤销旧的活动 Session。 */
function revoke_sessions_sql(): string {
  return "UPDATE federation_admin_sessions SET status = 'revoked', revoked_at = ? WHERE status = 'active'";
}

/** 构造 SQLite 参数对象。 */
function database_values(credentials: FederationAdminDeploymentCredentials): Record<string, string> {
  const now = new Date().toISOString();
  return {
    owner_slot: OWNER_SLOT,
    admin_id: credentials.admin_id,
    password_hash: credentials.password_hash,
    provision_id: credentials.provision_id,
    created_at: now,
    updated_at: now,
  };
}

/** 构造远程 D1 批量 SQL；明文密码从不进入该文件。 */
function build_remote_admin_sql(credentials: FederationAdminDeploymentCredentials): string {
  const values = database_values(credentials);
  const parameterized = credentials.mode === "reset"
    ? reset_administrator_sql()
    : initialize_administrator_sql();
  const statement = Object.entries(values).reduce(
    (sql, [key, value]) => sql.replaceAll(`@${key}`, sql_string(value)),
    parameterized,
  );
  const revoke = credentials.mode === "reset"
    ? `${revoke_sessions_sql().replace("?", sql_string(new Date().toISOString()))};`
    : "";
  return `${admin_schema_sql()};\n${statement};\n${revoke}\nSELECT admin_id, provision_id FROM federation_administrators WHERE owner_slot = 'owner' LIMIT 1;\n`;
}

/** 从 Wrangler D1 JSON 中递归查找最终管理员行。 */
function find_admin_result(value: unknown): { admin_id: string; provision_id: string } | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = find_admin_result(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const admin_id = typeof record.admin_id === "string" ? record.admin_id.trim() : "";
  const provision_id = typeof record.provision_id === "string" ? record.provision_id.trim() : "";
  if (admin_id) return { admin_id, provision_id };
  for (const child of Object.values(record)) {
    const found = find_admin_result(child);
    if (found) return found;
  }
  return undefined;
}

/** 转义 SQL 字符串字面量。 */
function sql_string(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** shell 参数转义。 */
function shell_quote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}
