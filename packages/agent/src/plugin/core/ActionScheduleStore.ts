/**
 * ActionSchedule 持久化存储。
 *
 * 关键点（中文）
 * - ActionSchedule 是 plugin action 的延迟执行能力，不是一个独立 plugin。
 * - 任务使用项目内 `jsonl` 事件流持久化，不再依赖 SQLite。
 * - 这里采用“全量重放 + 内存归并”的最简实现，保持职责清晰且易于迁移。
 * - 文件只记录状态事件；对外仍暴露稳定的调度任务查询与状态更新接口。
 */

import type {
  ActionScheduleJobRecord,
  ActionScheduleJobStatus,
  CreateActionScheduleJobInput,
} from "@/plugin/types/ActionSchedule.js";
import { generateId } from "@/utils/Id.js";
import { getDowncityScheduleDbPath } from "@/workspace/WorkspacePaths.js";
import type { FileSystem } from "@/types/workspace/FileSystem.js";

type ActionScheduleJobEvent =
  | {
      /**
       * 事件版本号。
       */
      v: 1;
      /**
       * 事件类型：创建任务。
       */
      type: "created";
      /**
       * ActionSchedule 任务快照。
       */
      job: ActionScheduleJobRecord;
    }
  | {
      /**
       * 事件版本号。
       */
      v: 1;
      /**
       * 事件类型：状态更新。
       */
      type: "status";
      /**
       * 目标任务 ID。
       */
      jobId: string;
      /**
       * 新状态。
       */
      status: ActionScheduleJobStatus;
      /**
       * 最新更新时间。
       */
      updatedAt: number;
      /**
       * 可选错误信息。
       */
      error?: string;
    };

async function read_jsonl_lines(
  files: FileSystem,
  file_path: string,
): Promise<string[]> {
  if (!(await files.path_exists(file_path))) return [];
  const raw = (await files.read_file(file_path)).toString("utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeJobRecord(
  input: ActionScheduleJobRecord,
): ActionScheduleJobRecord {
  return {
    id: String(input.id || "").trim(),
    pluginName: String(input.pluginName || "").trim(),
    actionName: String(input.actionName || "").trim(),
    payload: input.payload ?? null,
    runAtMs: Math.trunc(input.runAtMs),
    status: input.status,
    ...(typeof input.error === "string" && input.error
      ? { error: input.error }
      : {}),
    createdAt: Math.trunc(input.createdAt),
    updatedAt: Math.trunc(input.updatedAt),
  };
}

function parseEvent(line: string): ActionScheduleJobEvent | null {
  try {
    const raw = JSON.parse(line) as Partial<ActionScheduleJobEvent> | null;
    if (!raw || typeof raw !== "object") return null;
    if (raw.type === "created" && raw.job) {
      return {
        v: 1,
        type: "created",
        job: normalizeJobRecord(raw.job as ActionScheduleJobRecord),
      };
    }
    if (
      raw.type === "status" &&
      typeof raw.jobId === "string" &&
      typeof raw.status === "string" &&
      typeof raw.updatedAt === "number"
    ) {
      return {
        v: 1,
        type: "status",
        jobId: raw.jobId,
        status: raw.status as ActionScheduleJobStatus,
        updatedAt: Math.trunc(raw.updatedAt),
        ...(typeof raw.error === "string" ? { error: raw.error } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function compareJobs(
  a: ActionScheduleJobRecord,
  b: ActionScheduleJobRecord,
): number {
  if (a.runAtMs !== b.runAtMs) return a.runAtMs - b.runAtMs;
  return b.createdAt - a.createdAt;
}

/**
 * ActionSchedule Store。
 */
export class ActionScheduleStore {
  private readonly file_path: string;
  private readonly lock_path: string;
  private readonly files: FileSystem;

  constructor(files: FileSystem) {
    this.files = files;
    this.file_path = getDowncityScheduleDbPath(files.root_path);
    this.lock_path = `${this.file_path}.lock`;
  }

  /**
   * 关闭存储。
   *
   * 说明（中文）
   * - jsonl 版本无需保持长连接，因此 close 为 no-op。
   */
  close(): void {}

  /**
   * 创建调度任务。
   */
  async createJob(input: CreateActionScheduleJobInput): Promise<ActionScheduleJobRecord> {
    const now = Date.now();
    const job: ActionScheduleJobRecord = {
      id: `sched_${generateId()}`,
      pluginName: String(input.pluginName || "").trim(),
      actionName: String(input.actionName || "").trim(),
      payload: input.payload ?? null,
      runAtMs: Math.trunc(input.runAtMs),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await this.with_store_lock(async () => {
      await this.append_event_unlocked({
        v: 1,
        type: "created",
        job,
      });
    });
    return job;
  }

  /**
   * 获取单个任务。
   */
  async getJobById(jobId: string): Promise<ActionScheduleJobRecord | null> {
    const key = String(jobId || "").trim();
    if (!key) return null;
    return await this.with_store_lock(async () =>
      (await this.read_job_map_unlocked()).get(key) || null
    );
  }

  /**
   * 列出指定状态的任务。
   */
  async listJobsByStatus(
    statuses: ActionScheduleJobStatus[],
  ): Promise<ActionScheduleJobRecord[]> {
    if (statuses.length === 0) return [];
    const allowed = new Set(statuses);
    return await this.with_store_lock(async () =>
      (await this.read_jobs_unlocked())
        .filter((job) => allowed.has(job.status))
        .sort(compareJobs)
    );
  }

  /**
   * 列出任务。
   */
  async listJobs(params?: {
    status?: ActionScheduleJobStatus;
    limit?: number;
  }): Promise<ActionScheduleJobRecord[]> {
    const limit =
      typeof params?.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.trunc(params.limit))
        : 100;
    return await this.with_store_lock(async () => {
      const jobs = (await this.read_jobs_unlocked())
        .filter((job) => !params?.status || job.status === params.status)
        .sort(compareJobs);
      return jobs.slice(0, limit);
    });
  }

  /**
   * 列出已到点且待执行的任务。
   */
  async listDuePendingJobs(nowMs: number): Promise<ActionScheduleJobRecord[]> {
    return await this.with_store_lock(async () =>
      (await this.read_jobs_unlocked())
        .filter(
          (job) =>
            job.status === "pending" && job.runAtMs <= Math.trunc(nowMs),
        )
        .sort(compareJobs)
    );
  }

  /**
   * 启动恢复时，把历史 `running` 回退到 `pending`。
   */
  async resetRunningJobsToPending(): Promise<number> {
    return await this.with_store_lock(async () => {
      const running_jobs = (await this.read_jobs_unlocked())
        .filter((job) => job.status === "running");
      const now = Date.now();
      for (const job of running_jobs) {
        await this.append_event_unlocked({
          v: 1,
          type: "status",
          jobId: job.id,
          status: "pending",
          updatedAt: now,
        });
      }
      return running_jobs.length;
    });
  }

  /**
   * 将任务标记为执行中。
   */
  async markJobRunning(jobId: string): Promise<boolean> {
    return await this.transition_pending_job(jobId, "running");
  }

  /**
   * 将任务标记为成功。
   */
  async markJobSucceeded(jobId: string): Promise<boolean> {
    return await this.update_terminal_status({
      jobId,
      status: "succeeded",
    });
  }

  /**
   * 将任务标记为失败。
   */
  async markJobFailed(jobId: string, error: string): Promise<boolean> {
    return await this.update_terminal_status({
      jobId,
      status: "failed",
      error,
    });
  }

  /**
   * 取消待执行任务。
   */
  async cancelPendingJob(jobId: string): Promise<boolean> {
    return await this.transition_pending_job(jobId, "cancelled");
  }

  /**
   * 仅读取当前任务快照。
   */
  private async read_jobs_unlocked(): Promise<ActionScheduleJobRecord[]> {
    return [...(await this.read_job_map_unlocked()).values()];
  }

  /**
   * 重放事件流，构造当前任务快照。
   */
  private async read_job_map_unlocked(): Promise<Map<string, ActionScheduleJobRecord>> {
    const jobs = new Map<string, ActionScheduleJobRecord>();
    for (const line of await read_jsonl_lines(this.files, this.file_path)) {
      const event = parseEvent(line);
      if (!event) continue;
      if (event.type === "created") {
        jobs.set(event.job.id, normalizeJobRecord(event.job));
        continue;
      }
      const current = jobs.get(event.jobId);
      if (!current) continue;
      jobs.set(event.jobId, {
        ...current,
        status: event.status,
        updatedAt: event.updatedAt,
        ...(event.error ? { error: event.error } : {}),
        ...(event.status === "succeeded" || event.status === "cancelled"
          ? { error: undefined }
          : {}),
      });
    }
    return jobs;
  }

  /**
   * 追加单条事件。
   */
  private async append_event_unlocked(event: ActionScheduleJobEvent): Promise<void> {
    await this.files.append_file(this.file_path, `${JSON.stringify(event)}\n`);
  }

  /** 使用 Workspace 跨进程锁串行执行一次调度存储事务。 */
  private async with_store_lock<T>(action: () => Promise<T>): Promise<T> {
    return await this.files.with_file_lock(this.lock_path, action);
  }

  /**
   * 执行 pending -> target 的状态迁移。
   */
  private async transition_pending_job(
    jobId: string,
    status: "running" | "cancelled",
  ): Promise<boolean> {
    return await this.with_store_lock(async () => {
      const current = (await this.read_job_map_unlocked()).get(jobId);
      if (!current || current.status !== "pending") return false;
      await this.append_event_unlocked({
        v: 1,
        type: "status",
        jobId: current.id,
        status,
        updatedAt: Date.now(),
      });
      return true;
    });
  }

  /**
   * 统一写入终态。
   */
  private async update_terminal_status(params: {
    jobId: string;
    status: Exclude<ActionScheduleJobStatus, "pending" | "running">;
    error?: string;
  }): Promise<boolean> {
    return await this.with_store_lock(async () => {
      const current = (await this.read_job_map_unlocked()).get(params.jobId);
      if (!current || current.status !== "running") return false;
      await this.append_event_unlocked({
        v: 1,
        type: "status",
        jobId: current.id,
        status: params.status,
        updatedAt: Date.now(),
        ...(params.error ? { error: String(params.error) } : {}),
      });
      return true;
    });
  }
}
