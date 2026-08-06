/**
 * Cloudflare Workers 部署器。
 *
 * 关键点（中文）
 * - `fed deploy` 部署 Federation，不要求用户直接维护 Wrangler 工程。
 * - 构建和类型检查从 package.json 自动推断，稳定资源由 `federation.json` 声明。
 * - D1 database id 与 Worker URL 都是部署状态，不写入项目配置。
 */

import { rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  read_server_by_fed_id,
  register_deployed_server,
} from "@/federation/core/session.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import type {
  FederationDeployOptions,
  FederationProjectConfigFile,
} from "@/federation/types/FederationProjectConfig.js";
import type {
  FederationPackageScriptResult,
} from "@/federation/types/FederationDeployRuntime.js";
import { resolveCloudflareAccount } from "@/federation/deploy/runtime/CloudflareAccountResolver.js";
import { resolveD1Database } from "@/federation/deploy/runtime/D1DatabaseResolver.js";
import { resolveQueue } from "@/federation/deploy/runtime/QueueResolver.js";
import { resolveR2Bucket } from "@/federation/deploy/runtime/R2BucketResolver.js";
import { writeWranglerConfig } from "@/federation/deploy/runtime/WranglerConfigWriter.js";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";
import { bumpProjectPatchVersion } from "@/federation/deploy/runtime/ProjectVersionManager.js";
import { runPackageDeployScripts } from "@/federation/deploy/runtime/PackageScriptRunner.js";
import {
  create_admin_deployment_credentials,
  show_admin_credentials_once,
  verify_admin_deployment_credentials,
} from "@/federation/deploy/runtime/AdminCredentials.js";
import { provision_cloudflare_admin_database } from "@/federation/deploy/runtime/AdminDatabaseProvisioner.js";
import { with_cli_progress } from "@/shared/CliProgress.js";

const WORKER_INITIALIZATION_TIMEOUT_MS = 30_000;
const WORKER_HEALTH_RETRY_MS = 500;

/**
 * 部署 Cloudflare Workers City 项目。
 */
export async function deploy_cloudflare_workers(
  config_file: FederationProjectConfigFile,
  options: FederationDeployOptions,
): Promise<void> {
  const registered = read_server_by_fed_id(config_file.config.id, "cloudflare-workers");
  emitCliBlock({
    tone: "accent",
    title: "Project",
    facts: [
      { label: "name", value: config_file.config.name },
      { label: "target", value: config_file.config.deployment.target },
      { label: "source", value: config_file.project_dir },
    ],
  });

  if (options.verify_only) {
    await verifyWorker(registered?.base_url);
    return;
  }

  const version_bump =
    options.dry_run === true ? undefined : bumpProjectPatchVersion(config_file.project_dir);
  if (version_bump) {
    emitCliBlock({
      tone: "success",
      title: "Version",
      facts: [
        { label: "from", value: version_bump.previous_version },
        { label: "to", value: version_bump.next_version },
      ],
    });
  }

  await run_cloudflare_build(config_file, options);

  const custom_deploy = config_file.config.deployment.scripts?.deploy?.trim();
  if (custom_deploy) {
    if (options.admin_reset) {
      throw new CliError({
        title: "Custom deploy scripts cannot reset Federation administrators",
        note: "Downcity cannot prove that a custom script controls the target infrastructure.",
      });
    }
    await run_custom_cloudflare_deploy(config_file, options, custom_deploy);
    return;
  }

  const account_result = await resolveCloudflareAccount({
    project_dir: config_file.project_dir,
    account_id: options.account_id,
  });
  const account_id = account_result.account_id;

  const d1_result = await resolveD1Database({
    config_file,
    account_id,
    create_if_missing: options.dry_run !== true,
  });
  const queue_result = await resolveQueue({
    config_file,
    account_id,
    create_if_missing: options.dry_run !== true,
  });
  const storage_result = await resolveR2Bucket({
    config_file,
    account_id,
    create_if_missing: options.dry_run !== true,
  });

  const admin_credentials = !options.dry_run && (options.admin_reset || !registered?.admin_id)
    ? await create_admin_deployment_credentials(options.admin_reset ? "reset" : "initialize")
    : undefined;
  const wrangler_result = writeWranglerConfig(config_file, d1_result.resolved_database_id);
  emitCliBlock({
    tone: "success",
    title: "D1 Database",
    facts: [
      { label: "name", value: d1_result.summary.name ?? "(none)" },
      { label: "id", value: d1_result.summary.id ?? "(none)" },
      { label: "status", value: d1_result.summary.status },
    ],
  });
  emitCliBlock({
    tone: "success",
    title: "Queue",
    facts: [
      { label: "name", value: queue_result.summary.name ?? "(none)" },
      { label: "status", value: queue_result.summary.status },
    ],
  });
  emitCliBlock({
    tone: "success",
    title: "Storage",
    facts: [
      { label: "type", value: storage_result.summary.type ?? "(none)" },
      { label: "name", value: storage_result.summary.name ?? "(none)" },
      { label: "status", value: storage_result.summary.status },
    ],
  });

  let output = "";
  let worker_url: string | undefined;
  let provisioned_admin_id = registered?.admin_id;
  try {
    output = await runWranglerDeploy(config_file, {
      account_id,
      config_path: wrangler_result.config_path,
      dry_run: options.dry_run,
    });
    worker_url = config_file.config.deployment.url ?? extractWorkerUrl(output);
    if (worker_url && !options.dry_run) {
      await with_cli_progress({
        title: "Wait for Federation Worker",
        detail: `${worker_url}/health`,
      }, async () => await wait_for_worker_health(worker_url!, WORKER_INITIALIZATION_TIMEOUT_MS));
      if (admin_credentials) {
        const database_binding = config_file.config.deployment.resources.d1?.binding;
        const database_id = d1_result.resolved_database_id;
        if (!database_binding || !database_id) {
          throw new CliError({ title: "Federation administrator deployment requires a D1 database" });
        }
        const admin_result = await provision_cloudflare_admin_database({
          project_dir: config_file.project_dir,
          account_id,
          wrangler_config_path: wrangler_result.config_path,
          database_binding,
          database_id,
          credentials: admin_credentials,
        });
        provisioned_admin_id = admin_result.admin_id;
        if (admin_result.credentials_applied) {
          const verified = await with_cli_progress({
            title: "Verify Federation administrator",
            detail: `${worker_url}/v1/admin/login`,
          }, async () => await verify_admin_deployment_credentials(worker_url!, admin_credentials));
          if (!verified) {
            throw new CliError({
              title: "Federation administrator database update could not be verified",
              note: "D1 accepted the administrator update, but the deployed Worker rejected the new credentials.",
            });
          }
        } else if (options.admin_reset) {
          throw new CliError({
            title: "Federation administrator reset was not applied",
            note: "D1 did not persist the generated recovery credentials.",
          });
        }
      }
    }
  } finally {
    rmSync(dirname(wrangler_result.config_path), { recursive: true, force: true });
  }

  if (!worker_url && !options.dry_run) {
    throw new CliError({
      title: "Unable to read deployed Worker URL",
      note: "Wrangler completed without a detectable workers.dev URL.",
      fix: "Set deployment.url in federation.json and rerun `fed deploy`.",
    });
  }

  emitCliBlock({
    tone: "success",
    title: "Wrangler",
    facts: [
      { label: "config", value: wrangler_result.config_path },
      { label: "status", value: options.dry_run ? "dry-run" : "deployed" },
    ],
  });

  emitCliBlock({
    tone: "success",
    title: "Deployment",
    facts: [
      { label: "worker", value: config_file.config.name },
      ...(worker_url ? [{ label: "url", value: worker_url }] : []),
      { label: "status", value: options.dry_run ? "dry-run" : "success" },
    ],
  });

  if (worker_url && !options.dry_run) {
    const registered_server = register_deployed_server({
      config: config_file.config,
      project_dir: config_file.project_dir,
      base_url: worker_url,
      status: "deployed",
      admin_id: provisioned_admin_id,
    });
    emitCliBlock({
      tone: "success",
      title: "Federation Registry",
      facts: [
        { label: "name", value: registered_server.name },
        { label: "url", value: registered_server.base_url },
        { label: "admin", value: registered_server.admin_id ?? "existing credentials required" },
        { label: "status", value: "registered" },
      ],
    });
    if (admin_credentials && provisioned_admin_id === admin_credentials.admin_id) {
      show_admin_credentials_once(admin_credentials);
    }
  } else {
    emitCliBlock({
      tone: "info",
      title: "Federation Registry",
      facts: [
        { label: "name", value: config_file.config.name },
        ...(worker_url ? [{ label: "url", value: worker_url }] : []),
        { label: "status", value: "skipped" },
      ],
    });
  }

  if (options.verify && !options.dry_run) {
    await verifyWorker(worker_url);
  }
}

/** 执行自定义 build 或 Cloudflare 内置 package build/typecheck。 */
async function run_cloudflare_build(
  config_file: FederationProjectConfigFile,
  options: FederationDeployOptions,
): Promise<void> {
  const custom_build = config_file.config.deployment.scripts?.build?.trim();
  if (custom_build && !options.skip_build) {
    await runCommand({
      label: "Federation build",
      command: custom_build,
      cwd: config_file.project_dir,
      capture: true,
    });
    emitCliBlock({
      tone: "success",
      title: "Build",
      facts: [{ label: "command", value: custom_build }, { label: "status", value: "passed" }],
    });
    return;
  }
  const scripts_result = await runPackageDeployScripts({
    project_dir: config_file.project_dir,
    skip_build: options.skip_build,
    skip_typecheck: options.skip_typecheck,
  });
  emitPackageScriptSummary("Build", scripts_result.build);
  emitPackageScriptSummary("Typecheck", scripts_result.typecheck);
}

/** 使用用户脚本替换完整 Cloudflare 发布阶段。 */
async function run_custom_cloudflare_deploy(
  config_file: FederationProjectConfigFile,
  options: FederationDeployOptions,
  command: string,
): Promise<void> {
  if (options.dry_run) {
    emitCliBlock({
      tone: "success",
      title: "Custom deployment dry-run",
      facts: [{ label: "command", value: command }, { label: "status", value: "skipped" }],
      note: "Custom deploy scripts are not executed during dry-run.",
    });
    return;
  }
  const output = await runCommand({
    label: "Custom Federation deploy",
    command,
    cwd: config_file.project_dir,
    capture: true,
  });
  const deployed_url = config_file.config.deployment.url ?? extractHttpUrl(output);
  if (deployed_url) {
    register_deployed_server({
      config: config_file.config,
      project_dir: config_file.project_dir,
      base_url: deployed_url,
      status: "deployed",
    });
  }
  emitCliBlock({
    tone: "success",
    title: "Custom Federation deployed",
    facts: [
      { label: "command", value: command },
      ...(deployed_url ? [{ label: "url", value: deployed_url }] : []),
      { label: "status", value: "success" },
    ],
    note: deployed_url ? undefined : "Set deployment.url to register this deployment in fed.",
  });
  if (options.verify && deployed_url) await verifyWorker(deployed_url);
}

/** 等待 Worker 完成 Federation 初始化并创建系统表。 */
async function wait_for_worker_health(base_url: string, timeout_ms: number): Promise<void> {
  const health_url = `${base_url.replace(/\/+$/u, "")}/health`;
  const deadline = Date.now() + timeout_ms;
  let last_error = "health endpoint did not respond";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(health_url);
      if (response.ok) return;
      last_error = `${health_url} returned HTTP ${response.status}`;
    } catch (error) {
      last_error = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, WORKER_HEALTH_RETRY_MS));
  }
  throw new CliError({
    title: "Worker initialization failed",
    note: last_error,
    fix: "Check the deployed Worker logs and /health endpoint, then rerun `fed deploy`.",
  });
}

/**
 * 输出 package script 执行摘要。
 */
function emitPackageScriptSummary(
  title: "Build" | "Typecheck",
  result: FederationPackageScriptResult,
): void {
  emitCliBlock({
    tone: result.status === "passed" ? "success" : "info",
    title,
    facts: [
      { label: "command", value: result.command },
      { label: "status", value: result.status },
    ],
  });
}

/**
 * 执行 Wrangler deploy。
 */
async function runWranglerDeploy(
  config_file: FederationProjectConfigFile,
  params: {
    account_id?: string;
    config_path: string;
    dry_run: boolean;
  },
): Promise<string> {
  return await runCommand({
    label: params.dry_run ? "Wrangler dry-run" : "Wrangler deploy",
    command: params.dry_run
      ? `pnpm exec wrangler deploy --config ${shellQuote(params.config_path)} --dry-run`
      : `pnpm exec wrangler deploy --config ${shellQuote(params.config_path)}`,
    cwd: config_file.project_dir,
    env: { CLOUDFLARE_ACCOUNT_ID: params.account_id },
    capture: true,
  });
}

/**
 * 验证 Worker 健康状态。
 */
async function verifyWorker(base_url: string | undefined): Promise<void> {
  if (!base_url?.trim()) {
    emitCliBlock({
      tone: "warning",
      title: "Verification skipped",
      note: "No deployment is registered for this Fed. Run `fed deploy` first.",
    });
    return;
  }

  const url = `${base_url.replace(/\/+$/, "")}/health`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new CliError({
      title: "Worker verification failed",
      note: `${url} returned HTTP ${response.status}.`,
      fix: "Check the deployed Worker URL and Cloudflare deployment logs.",
    });
  }

  const text = await response.text();
  emitCliBlock({
    tone: "success",
    title: "Worker verified",
    facts: [
      { label: "url", value: url },
      { label: "status", value: String(response.status) },
    ],
    note: text.length > 240 ? `${text.slice(0, 240)}...` : text,
  });
}

/**
 * 从 Wrangler 输出中提取 Worker URL。
 */
function extractWorkerUrl(output: string): string | undefined {
  return output.match(/https:\/\/[^\s]+\.workers\.dev/i)?.[0];
}

/** 从自定义脚本输出中读取第一个 HTTP URL。 */
function extractHttpUrl(output: string): string | undefined {
  return output.match(/https?:\/\/[^\s]+/iu)?.[0];
}

/**
 * shell 参数转义。
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
