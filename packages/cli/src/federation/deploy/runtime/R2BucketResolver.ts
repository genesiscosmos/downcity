/**
 * Cloudflare R2 bucket 解析器。
 *
 * 关键点（中文）
 * - Storage 是 Workers 目标的默认文件存储资源，由 `fed deploy` 自动准备。
 * - 用户只需要在 `federation.json.resources.storage` 声明稳定资源名和公开 URL。
 * - R2 bucket 没有需要写入项目配置的 id，Wrangler 配置只绑定 bucket name。
 */

import type {
  FederationProjectConfigFile,
} from "@/federation/types/FederationProjectConfig.js";
import type { FederationStorageSummary } from "@/federation/types/FederationDeployRuntime.js";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";

/** R2 bucket 解析参数。 */
export interface ResolveR2BucketParams {
  /** City 项目配置文件。 */
  config_file: FederationProjectConfigFile;
  /** Cloudflare account id。 */
  account_id?: string;
  /** 找不到同名 bucket 时是否允许创建。 */
  create_if_missing?: boolean;
}

/** R2 bucket 解析结果。 */
export interface ResolveR2BucketResult {
  /** 本次 Storage 准备摘要。 */
  summary: FederationStorageSummary;
}

/**
 * 确认 R2 bucket 存在，必要时创建。
 *
 * dry-run 模式不会创建远程 bucket；如果 bucket 不存在，只返回 pending 摘要，
 * 让 Wrangler dry-run 继续验证临时 binding 配置。
 */
export async function resolveR2Bucket(
  params: ResolveR2BucketParams,
): Promise<ResolveR2BucketResult> {
  const storage = params.config_file.config.deployment.resources.storage;
  if (!storage) {
    return {
      summary: { status: "skipped" },
    };
  }
  if (storage.type !== "r2") {
    return {
      summary: { name: storage.name, type: storage.type, status: "skipped" },
    };
  }

  const bucket_name = storage.name;
  const create_if_missing = params.create_if_missing !== false;
  const exists = await findExistingR2Bucket({
    project_dir: params.config_file.project_dir,
    account_id: params.account_id,
    bucket_name,
  });
  if (exists) {
    return {
      summary: {
        name: bucket_name,
        type: "r2",
        status: "reused",
      },
    };
  }

  if (!create_if_missing) {
    return {
      summary: {
        name: bucket_name,
        type: "r2",
        status: "pending",
      },
    };
  }

  await runCommand({
    label: "Create Cloudflare R2 bucket",
    command: `pnpm exec wrangler r2 bucket create ${shellQuote(bucket_name)}`,
    cwd: params.config_file.project_dir,
    env: { CLOUDFLARE_ACCOUNT_ID: params.account_id },
    capture: true,
  });

  return {
    summary: {
      name: bucket_name,
      type: "r2",
      status: "created",
    },
  };
}

/**
 * 从 Cloudflare 已有 R2 bucket 列表中查找同名 bucket。
 */
async function findExistingR2Bucket(
  params: {
    project_dir: string;
    account_id?: string;
    bucket_name: string;
  },
): Promise<boolean> {
  const output = await runCommand({
    label: "List Cloudflare R2 buckets",
    command: "pnpm exec wrangler r2 bucket list",
    cwd: params.project_dir,
    env: { CLOUDFLARE_ACCOUNT_ID: params.account_id },
    capture: true,
  });

  return hasBucketInListOutput(output, params.bucket_name);
}

/**
 * 从 Wrangler R2 bucket list 输出中判断指定 bucket 是否存在。
 */
function hasBucketInListOutput(output: string, bucket_name: string): boolean {
  const trimmed_output = output.trim();
  if (!trimmed_output) return false;

  try {
    const parsed = JSON.parse(trimmed_output) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { buckets?: unknown })?.buckets)
        ? (parsed as { buckets: unknown[] }).buckets
        : [];
    const has_json_bucket = items.some((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return String(record.name ?? record.bucket_name ?? "").trim() === bucket_name;
    });
    if (has_json_bucket) return true;
  } catch {
    // Wrangler R2 bucket list 可能是文本输出；JSON 解析失败时继续按表格/文本解析。
  }

  return readTextBucketNames(trimmed_output).some((name) => name === bucket_name);
}

/**
 * 从文本表格或纯文本输出中读取 bucket 名称。
 */
function readTextBucketNames(output: string): string[] {
  const names: string[] = [];
  for (const line of output.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    const clean_line = line.trim();
    if (!clean_line) continue;

    // 匹配 wrangler 4.x 的 "name:   bucket_name" 格式
    const name_match = clean_line.match(/^name:\s*(.+)$/);
    if (name_match) {
      const name = name_match[1].trim();
      if (isPossibleBucketName(name)) names.push(name);
      continue;
    }

    const cells = clean_line
      .split(/[│|]/g)
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length > 1) {
      names.push(...cells.filter(isPossibleBucketName));
      continue;
    }

    const plain_name = clean_line.replace(/^[-*]\s+/, "");
    if (isPossibleBucketName(plain_name)) names.push(plain_name);
  }
  return names;
}

/**
 * 判断文本片段是否像一个 Cloudflare R2 bucket 名称。
 */
function isPossibleBucketName(value: string): boolean {
  if (!value || value === "name" || value === "bucket" || value === "Bucket Name") return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

/**
 * shell 参数转义。
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
