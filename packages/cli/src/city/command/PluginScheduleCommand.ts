/**
 * `city plugin schedule` 命令。
 *
 * 关键点（中文）
 * - 命令名保留 schedule，是用户侧“延迟执行任务”的操作语义。
 * - 内部使用 Agent 的 ActionScheduleStore，不依赖独立 schedule plugin。
 * - 这里同时承载 schedule 子命令注册与 ActionSchedule 本地存储读写流程。
 */

import type { Command } from "commander";
import { ActionScheduleStore, Workspace } from "@downcity/agent";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import type { PluginCliBaseOptions } from "@downcity/agent";
import {
  normalizeScheduledJobStatus,
  parsePositiveIntOption,
  resolvePluginScheduleProjectRoot,
  validateAgentProjectRoot,
} from "@/city/shared/PluginTargetSupport.js";
import { parseBoolean } from "@/shared/IndexSupport.js";
import { helpText, t } from "@/shared/CliLocale.js";

/**
 * 注入 ActionSchedule 管理命令通用选项。
 */
function addPluginScheduleOptions(command: Command): Command {
  return command
    .option("--path <path>", t({
      zh: "项目根目录（默认当前目录）",
      en: "project root path (default: current directory)",
    }), ".")
    .option("--agent <id>", t({
      zh: "agent id（从 managed agent registry 解析）",
      en: "agent id resolved from the managed agent registry",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean, true);
}

/**
 * 执行 `plugin schedule list`。
 */
export async function runPluginScheduleListCommand(params: {
  options: PluginCliBaseOptions;
  statusRaw?: string;
  limitRaw?: string;
}): Promise<void> {
  const resolved = await resolvePluginScheduleProjectRoot(params.options);
  if (!resolved.project_root) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule list failed",
      payload: {
        error: resolved.error || "Failed to resolve agent project path",
      },
    });
    return;
  }
  const project_root = resolved.project_root;
  const pathError = validateAgentProjectRoot(project_root);
  if (pathError) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule list failed",
      payload: {
        error: pathError,
      },
    });
    return;
  }

  try {
    const status = normalizeScheduledJobStatus(params.statusRaw);
    const limit = params.limitRaw
      ? parsePositiveIntOption(params.limitRaw, "limit")
      : 100;
    const workspace = new Workspace({ path: project_root });
    const store = new ActionScheduleStore(workspace.files);
    try {
      const jobs = await store.list_jobs({ status, limit });
      printResult({
        asJson: params.options.json,
        success: true,
        title: "plugin schedule listed",
        payload: {
          ...(status ? { status } : {}),
          limit,
          count: jobs.length,
          jobs,
        },
      });
    } finally {
      store.close();
      await workspace.dispose();
    }
  } catch (error) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule list failed",
      payload: {
        error: String(error),
      },
    });
  }
}

/**
 * 执行 `plugin schedule info`。
 */
export async function runPluginScheduleInfoCommand(params: {
  job_id: string;
  options: PluginCliBaseOptions;
}): Promise<void> {
  const resolved = await resolvePluginScheduleProjectRoot(params.options);
  if (!resolved.project_root) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule info failed",
      payload: {
        error: resolved.error || "Failed to resolve agent project path",
      },
    });
    return;
  }
  const project_root = resolved.project_root;
  const pathError = validateAgentProjectRoot(project_root);
  if (pathError) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule info failed",
      payload: {
        error: pathError,
      },
    });
    return;
  }

  const job_id = String(params.job_id || "").trim();
  if (!job_id) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule info failed",
      payload: {
        error: "job_id is required",
      },
    });
    return;
  }

  const workspace = new Workspace({ path: project_root });
  const store = new ActionScheduleStore(workspace.files);
  try {
    const job = await store.get_job_by_id(job_id);
    if (!job) {
      printResult({
        asJson: params.options.json,
        success: false,
        title: "plugin schedule info failed",
        payload: {
          error: `Scheduled job not found: ${job_id}`,
        },
      });
      return;
    }
    printResult({
      asJson: params.options.json,
      success: true,
      title: "plugin schedule info ok",
      payload: {
        job,
      },
    });
  } finally {
    store.close();
    await workspace.dispose();
  }
}

/**
 * 执行 `plugin schedule cancel`。
 */
export async function runPluginScheduleCancelCommand(params: {
  job_id: string;
  options: PluginCliBaseOptions;
}): Promise<void> {
  const resolved = await resolvePluginScheduleProjectRoot(params.options);
  if (!resolved.project_root) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule cancel failed",
      payload: {
        error: resolved.error || "Failed to resolve agent project path",
      },
    });
    return;
  }
  const project_root = resolved.project_root;
  const pathError = validateAgentProjectRoot(project_root);
  if (pathError) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule cancel failed",
      payload: {
        error: pathError,
      },
    });
    return;
  }

  const job_id = String(params.job_id || "").trim();
  if (!job_id) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin schedule cancel failed",
      payload: {
        error: "job_id is required",
      },
    });
    return;
  }

  const workspace = new Workspace({ path: project_root });
  const store = new ActionScheduleStore(workspace.files);
  try {
    const current = await store.get_job_by_id(job_id);
    if (!current) {
      printResult({
        asJson: params.options.json,
        success: false,
        title: "plugin schedule cancel failed",
        payload: {
          error: `Scheduled job not found: ${job_id}`,
        },
      });
      return;
    }
    if (current.status !== "pending") {
      printResult({
        asJson: params.options.json,
        success: false,
        title: "plugin schedule cancel failed",
        payload: {
          error: `Only pending jobs can be cancelled. Current status: ${current.status}`,
          job: current,
        },
      });
      return;
    }

    const cancelled = await store.cancel_pending_job(job_id);
    if (!cancelled) {
      printResult({
        asJson: params.options.json,
        success: false,
        title: "plugin schedule cancel failed",
        payload: {
          error: `Failed to cancel scheduled job: ${job_id}`,
        },
      });
      return;
    }

    printResult({
      asJson: params.options.json,
      success: true,
      title: "plugin schedule cancelled",
      payload: {
        job: await store.get_job_by_id(job_id),
      },
    });
  } finally {
    store.close();
    await workspace.dispose();
  }
}

/**
 * 注册 `plugin schedule` 子命令组。
 */
export function registerPluginScheduleCommands(plugin: Command): void {
  const schedule = plugin
    .command("schedule")
    .description(t({
      zh: "查看和管理持久化延迟 action 任务",
      en: "inspect and manage persisted delayed action jobs",
    }))
    .helpOption("--help", helpText());

  addPluginScheduleOptions(
    schedule
      .command("list")
      .description(t({
        zh: "列出当前 agent 的延迟 action 任务",
        en: "list delayed action jobs for the current agent",
      }))
      .option("--status <status>", t({
        zh: "状态过滤（pending|running|succeeded|failed|cancelled）",
        en: "status filter (pending|running|succeeded|failed|cancelled)",
      }))
      .option("--limit <n>", t({
        zh: "返回条数（默认 100）",
        en: "maximum number of results (default: 100)",
      })),
  ).action(async (opts: PluginCliBaseOptions & { status?: string; limit?: string }) => {
    await runPluginScheduleListCommand({
      options: opts,
      statusRaw: opts.status,
      limitRaw: opts.limit,
    });
  });

  addPluginScheduleOptions(
    schedule
      .command("info <job_id>")
      .description(t({
        zh: "查看单个延迟 action 任务详情",
        en: "show details for a single delayed action job",
      })),
  ).action(async (job_id: string, opts: PluginCliBaseOptions) => {
    await runPluginScheduleInfoCommand({
      job_id,
      options: opts,
    });
  });

  addPluginScheduleOptions(
    schedule
      .command("cancel <job_id>")
      .description(t({
        zh: "取消一个尚未执行的延迟 action 任务",
        en: "cancel a delayed action job that has not started yet",
      })),
  ).action(async (job_id: string, opts: PluginCliBaseOptions) => {
    await runPluginScheduleCancelCommand({
      job_id,
      options: opts,
    });
  });
}
