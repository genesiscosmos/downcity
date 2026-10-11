/**
 * Cloudflare D1 数据库解析器。
 *
 * 关键点（中文）
 * - D1 是 Workers 目标的运行时资源，由 `fed deploy` 自动准备。
 * - 用户只需要在 `federation.json.resources.d1` 声明稳定资源名。
 * - database id 由 CLI 在部署时自动解析，不写入项目配置。
 * - dry-run 不创建远程资源，只使用已有 database name 解析临时 Wrangler 配置。
 */

import { CliError } from "@/shared/CliError.js";
import type {
  FederationProjectConfigFile,
} from "@/federation/types/FederationProjectConfig.js";
import type { FederationD1DatabaseSummary } from "@/federation/types/FederationDeployRuntime.js";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";

/** D1 解析参数。 */
export interface ResolveD1DatabaseParams {
  /** City 项目配置文件。 */
  config_file: FederationProjectConfigFile;
  /** Cloudflare account id。 */
  account_id?: string;
  /** 找不到同名数据库时是否允许创建。 */
  create_if_missing?: boolean;
}

/** D1 解析结果。 */
export interface ResolveD1DatabaseResult {
  /** 本次部署解析出的 D1 database id。 */
  resolved_database_id?: string;
  /** 本次 D1 数据库准备摘要。 */
  summary: FederationD1DatabaseSummary;
}

/**
 * 确认 D1 数据库存在，必要时创建并写入项目 `.env`。
 */
export async function resolveD1Database(
  params: ResolveD1DatabaseParams,
): Promise<ResolveD1DatabaseResult> {
  const d1 = params.config_file.config.deployment.resources.d1;
  if (!d1) {
    return {
      summary: { status: "skipped" },
    };
  }
  const database_name = d1.name;
  const create_if_missing = params.create_if_missing !== false;

  const listed_database_id = await findExistingD1DatabaseId({
    project_dir: params.config_file.project_dir,
    account_id: params.account_id,
    database_name,
  });
  if (listed_database_id) {
    return {
      resolved_database_id: listed_database_id,
      summary: {
        name: database_name,
        id: listed_database_id,
        status: "reused",
      },
    };
  }

  if (!create_if_missing) {
    throw new CliError({
      title: "D1 database not found",
      note: `Cloudflare account does not have a D1 database named ${database_name}.`,
      fix: "Run `fed deploy` once without `--dry-run`, or update deployment.resources.d1.name.",
    });
  }

  const output = await runCommand({
    label: "Create D1 database",
    command: `pnpm exec wrangler d1 create ${shellQuote(database_name)}`,
    cwd: params.config_file.project_dir,
    env: { CLOUDFLARE_ACCOUNT_ID: params.account_id },
    capture: true,
  });
  const database_id = extractD1DatabaseId(output);
  if (!database_id) {
    throw new CliError({
      title: "Unable to read D1 database id",
      note: output,
      fix: "Create D1 manually or update deployment.resources.d1.name, then rerun `fed deploy`.",
    });
  }

  return {
    resolved_database_id: database_id,
    summary: {
      name: database_name,
      id: database_id,
      status: "created",
    },
  };
}

/**
 * 从 Wrangler 输出中提取 UUID。
 */
function extractD1DatabaseId(output: string): string | undefined {
  return output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
}

/**
 * 从 Cloudflare 已有 D1 列表中查找同名数据库。
 */
async function findExistingD1DatabaseId(
  params: {
    project_dir: string;
    account_id?: string;
    database_name: string;
  },
): Promise<string | undefined> {
  const output = await runCommand({
    label: "List D1 databases",
    command: "pnpm exec wrangler d1 list --json",
    cwd: params.project_dir,
    env: { CLOUDFLARE_ACCOUNT_ID: params.account_id },
    capture: true,
  });

  try {
    const parsed = JSON.parse(output) as Array<{ name?: unknown; uuid?: unknown }>;
    const matched = parsed.find((item) => String(item?.name ?? "").trim() === params.database_name);
    const database_id = String(matched?.uuid ?? "").trim();
    return database_id || undefined;
  } catch {
    return undefined;
  }
}

/**
 * shell 参数转义。
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
