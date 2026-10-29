/**
 * Cloudflare 发布前数据库准备编排。
 *
 * 子进程独立持有 Cloudflare account 环境和项目模块缓存；准备失败阻止上传 Worker。
 * dry-run 只检查项目准备导出，verify-only 不进入此阶段。
 */

import { resolve, join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";
import type { FederationProjectConfigFile } from "@/federation/types/FederationProjectConfig.js";
import type { WorkerDatabasePrepareInput } from "@/federation/deploy/runtime/WorkerDatabasePrepareRunner.js";

/** 使用项目 Worker 的 prepare_database 导出准备数据库。 */
export async function prepare_cloudflare_database(params: {
  /** 已校验的 Federation 项目配置。 */
  config_file: FederationProjectConfigFile;
  /** 本次部署解析的 Cloudflare account。 */
  account_id?: string;
  /** 与部署共用精确数据库 ID 的临时 Wrangler 配置。 */
  config_path: string;
  /** 是否只验证导出而不执行远程准备。 */
  dry_run: boolean;
}): Promise<string | undefined> {
  const result_dir = await mkdtemp(join(tmpdir(), "downcity-prepare-result-"));
  const result_path = join(result_dir, "administrator.json");
  try {
    const input: WorkerDatabasePrepareInput = {
      project_dir: params.config_file.project_dir,
      entry: resolve(params.config_file.project_dir, params.config_file.config.entry),
      config_path: params.config_path,
      dry_run: params.dry_run,
      hyperdrive: params.config_file.config.deployment.resources.hyperdrive,
      storage_public_url_prefix: params.config_file.config.deployment.resources.storage?.public_url_prefix,
      result_path,
    };
    const runner_url = new URL("./WorkerDatabasePrepareRunner.js", import.meta.url);
    const program = `try { const { run_worker_database_prepare } = await import(${JSON.stringify(runner_url.href)}); await run_worker_database_prepare(JSON.parse(process.argv[1])); } catch { console.error("Database preparation failed. Check prepare_database, migrated active owner, remote binding support, or database_url_env. Connection details are suppressed."); process.exitCode = 1; }`;
    await runCommand({
      label: params.dry_run ? "Check database preparation entry" : "Prepare Federation database",
      command: `${shell_quote(process.execPath)} --input-type=module --eval ${shell_quote(program)} ${shell_quote(JSON.stringify(input))}`,
      display_command: `prepare_database export in ${input.entry}`,
      cwd: input.project_dir,
      env: params.account_id ? { CLOUDFLARE_ACCOUNT_ID: params.account_id } : undefined,
      capture: true,
      suppress_error_output: true,
    });
    if (!input.hyperdrive || input.dry_run) return undefined;
    const result: unknown = JSON.parse(await readFile(result_path, "utf8"));
    if (!result || typeof result !== "object" || !("admin_id" in result)
      || typeof result.admin_id !== "string" || !result.admin_id.trim()) {
      throw new Error("PostgreSQL preparation did not return a migrated active owner");
    }
    return result.admin_id;
  } finally {
    await rm(result_dir, { recursive: true, force: true });
  }
}

/** 以 POSIX shell 单参数传递路径、JSON 与 JavaScript。 */
function shell_quote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}
