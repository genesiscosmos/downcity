/**
 * Cloudflare Queue 解析器。
 *
 * 关键点（中文）
 * - Queue 是 Workers 目标的运行时异步任务资源，由 `fed deploy` 自动准备。
 * - 用户只需要在 `federation.json.resources.queue` 声明稳定资源名。
 * - Queue 没有需要写入项目配置的 id，Wrangler 配置只绑定 queue name。
 */

import type {
  FederationProjectConfigFile,
} from "@/federation/types/FederationProjectConfig.js";
import type { FederationQueueSummary } from "@/federation/types/FederationDeployRuntime.js";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";

/** Queue 解析参数。 */
export interface ResolveQueueParams {
  /** City 项目配置文件。 */
  config_file: FederationProjectConfigFile;
  /** Cloudflare account id。 */
  account_id?: string;
  /** 找不到同名 Queue 时是否允许创建。 */
  create_if_missing?: boolean;
}

/** Queue 解析结果。 */
export interface ResolveQueueResult {
  /** 本次 Queue 准备摘要。 */
  summary: FederationQueueSummary;
}

/**
 * 确认 Queue 存在，必要时创建。
 *
 * dry-run 模式不会创建远程 Queue，也不需要解析远程 id；如果 Queue 不存在，
 * 只返回 pending 摘要，让 Wrangler dry-run 继续验证临时 binding 配置。
 */
export async function resolveQueue(
  params: ResolveQueueParams,
): Promise<ResolveQueueResult> {
  const queue = params.config_file.config.deployment.resources.queue;
  if (!queue) {
    return {
      summary: { status: "skipped" },
    };
  }
  const queue_name = queue.name;
  const create_if_missing = params.create_if_missing !== false;

  const exists = await findExistingQueue({
    project_dir: params.config_file.project_dir,
    account_id: params.account_id,
    queue_name,
  });
  if (exists) {
    return {
      summary: {
        name: queue_name,
        status: "reused",
      },
    };
  }

  if (!create_if_missing) {
    return {
      summary: {
        name: queue_name,
        status: "pending",
      },
    };
  }

  await runCommand({
    label: "Create Cloudflare Queue",
    command: `pnpm exec wrangler queues create ${shellQuote(queue_name)}`,
    cwd: params.config_file.project_dir,
    env: { CLOUDFLARE_ACCOUNT_ID: params.account_id },
    capture: true,
  });

  return {
    summary: {
      name: queue_name,
      status: "created",
    },
  };
}

/**
 * 从 Cloudflare 已有 Queue 列表中查找同名 Queue。
 */
async function findExistingQueue(
  params: {
    project_dir: string;
    account_id?: string;
    queue_name: string;
  },
): Promise<boolean> {
  const output = await runCommand({
    label: "List Cloudflare Queues",
    command: "pnpm exec wrangler queues list",
    cwd: params.project_dir,
    env: { CLOUDFLARE_ACCOUNT_ID: params.account_id },
    capture: true,
  });

  return hasQueueInListOutput(output, params.queue_name);
}

/**
 * 从 Wrangler Queue 列表输出中判断指定 Queue 是否存在。
 */
function hasQueueInListOutput(output: string, queue_name: string): boolean {
  const trimmed_output = output.trim();
  if (!trimmed_output) return false;

  try {
    const parsed = JSON.parse(trimmed_output) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { queues?: unknown })?.queues)
        ? (parsed as { queues: unknown[] }).queues
        : [];
    const has_json_queue = items.some((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return String(record.name ?? record.queue_name ?? "").trim() === queue_name;
    });
    if (has_json_queue) return true;
  } catch {
    // Wrangler Queue list 当前是文本输出；JSON 解析失败时继续按表格/文本解析。
  }

  return readTextQueueNames(trimmed_output).some((name) => name === queue_name);
}

/**
 * 从文本表格或纯文本输出中读取 Queue 名称。
 */
function readTextQueueNames(output: string): string[] {
  const names: string[] = [];
  for (const line of output.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    const cells = line
      .split(/[│|]/g)
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length > 1) {
      names.push(...cells.filter(isPossibleQueueName));
      continue;
    }

    const plain_name = line.trim().replace(/^[-*]\s+/, "");
    if (isPossibleQueueName(plain_name)) names.push(plain_name);
  }
  return names;
}

/**
 * 判断文本片段是否像一个 Cloudflare Queue 名称。
 */
function isPossibleQueueName(value: string): boolean {
  if (!value || value === "name" || value === "queue" || value === "Queue Name") return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

/**
 * shell 参数转义。
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
