/**
 * City 部署目标解析器。
 *
 * 关键点（中文）
 * - `fed deploy` 默认读取当前目录。
 * - 模板仓库应先通过 `fed create --template <git-url>` 创建为本地项目。
 * - 部署命令不承担项目获取职责，避免部署状态没有明确归属。
 */

import { resolve } from "node:path";
import type { FederationDeploySource } from "@/federation/types/FederationProjectConfig.js";
import { CliError } from "@/shared/CliError.js";

/**
 * 解析部署目标。
 */
export async function resolve_federation_deploy_source(
  source: string | undefined,
): Promise<FederationDeploySource> {
  const normalized_source = String(source || ".").trim() || ".";
  if (isGitUrl(normalized_source)) {
    throw new CliError({
      title: "fed deploy only accepts a local project path",
      note: `Received Git URL: ${normalized_source}`,
      fix: "Run `fed create --template <git-url>` first, then deploy the created local project.",
    });
  }

  return {
    project_dir: resolve(normalized_source),
    source: normalized_source,
  };
}

/**
 * 判断输入是否像 Git URL。
 */
function isGitUrl(value: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(value)
    || /^[^@\s]+@[^:\s]+:[^\s]+$/.test(value);
}
