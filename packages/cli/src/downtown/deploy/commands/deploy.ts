/**
 * `fed deploy` 命令实现 —— 统一部署本地或远程 Downtown。
 *
 * 关键点（中文）
 * - 命令层只负责读取目录、解析选项和选择 runtime deployer。
 * - 具体 Cloudflare / D1 / Wrangler 细节放在 runtime 模块中。
 * - `downtown.toml` 是部署协议入口，避免用户直接记忆底层 Worker 脚本。
 */

import { CliError } from "@/shared/CliError.js";
import type { DowntownDeployOptions } from "@/downtown/types/DowntownProjectConfig.js";
import { read_downtown_project_config } from "@/downtown/deploy/config/DowntownProjectConfigReader.js";
import { deploy_cloudflare_workers } from "@/downtown/deploy/runtime/CloudflareWorkersDeployer.js";
import { deploy_local_downtown } from "@/downtown/deploy/runtime/LocalDowntownDeployer.js";
import { resolve_downtown_deploy_source } from "@/downtown/deploy/config/DowntownDeployTargetResolver.js";
import { confirm, isCancel } from "@/downtown/tui/Prompts.js";

/** Commander 传入的原始 deploy 选项。 */
export interface DowntownDeployCommandOptions {
  /** 是否只执行 dry-run。 */
  dryRun?: boolean;
  /** 是否部署后验证。 */
  verify?: boolean;
  /** 是否只执行验证。 */
  verifyOnly?: boolean;
  /** 是否跳过构建。 */
  skipBuild?: boolean;
  /** 是否跳过类型检查。 */
  skipTypecheck?: boolean;
  /** 本次部署使用的 Cloudflare account id。 */
  accountId?: string;
  /** 是否通过部署权限恢复管理员。 */
  adminReset?: boolean;
  /** 是否跳过管理员恢复确认。 */
  yes?: boolean;
}

/**
 * 执行 Downtown 项目部署。
 */
export async function deploy_downtown_project(
  source: string = ".",
  raw_options: DowntownDeployCommandOptions = {},
): Promise<void> {
  const options: DowntownDeployOptions = {
    source,
    dry_run: raw_options.dryRun === true,
    verify: raw_options.verify === true,
    verify_only: raw_options.verifyOnly === true,
    skip_build: raw_options.skipBuild === true,
    skip_typecheck: raw_options.skipTypecheck === true,
    account_id: raw_options.accountId,
    admin_reset: raw_options.adminReset === true,
    yes: raw_options.yes === true,
  };
  const target = await resolve_downtown_deploy_source(options.source);
  const config_file = read_downtown_project_config(target.project_dir);
  await confirm_admin_reset(config_file.config.name, config_file.config.deployment.target, options);

  switch (config_file.config.deployment.target) {
    case "local":
      await deploy_local_downtown(config_file, options);
      return;
    case "cloudflare-workers":
      await deploy_cloudflare_workers(config_file, options);
      return;
    default:
      throw new CliError({
        title: "Unsupported Downtown target",
        note: `fed deploy does not support ${config_file.config.deployment.target}.`,
      });
  }
}

/** 对灾难恢复执行第二道显式确认，普通部署不进入该分支。 */
async function confirm_admin_reset(
  downtown_name: string,
  target: string,
  options: DowntownDeployOptions,
): Promise<void> {
  if (!options.admin_reset) return;
  if (options.dry_run || options.verify_only) {
    throw new CliError({ title: "--admin-reset 不能与 --dry-run 或 --verify-only 同时使用。" });
  }
  if (options.yes) return;
  const accepted = await confirm({
    message: `确认重置 ${downtown_name} (${target}) 的管理员？全部现有管理会话将失效。`,
    initialValue: false,
  });
  if (isCancel(accepted) || accepted !== true) {
    throw new CliError({ title: "已取消 Downtown 管理员重置。" });
  }
}
