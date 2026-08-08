/**
 * Session 标题后台任务协调器。
 *
 * 关键点（中文）
 * - 标题生成属于 metadata 增强任务，不得阻塞 Turn 主链路。
 * - 同一个 Session 同时只允许一个标题任务运行。
 * - 任务失败只记录日志，不能反向影响 Prompt 或 Executor。
 */

import type { Logger } from "@/utils/logger/Logger.js";

/** 标题后台任务执行函数。 */
export type SessionTitleTaskRunner = (signal: AbortSignal) => Promise<void>;

/** Session 标题后台任务协调器配置。 */
export interface SessionTitleTaskOptions {
  /** 当前 Session 的稳定标识。 */
  session_id: string;

  /** 用于记录后台任务失败的统一日志器。 */
  logger: Logger;
}

/** Session 标题后台任务协调器。 */
export class SessionTitleTask {
  private readonly session_id: string;
  private readonly logger: Logger;
  private active_task: Promise<void> | null = null;
  private abort_controller: AbortController | null = null;
  private pending_runner: SessionTitleTaskRunner | null = null;
  private disposed = false;

  constructor(options: SessionTitleTaskOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.logger = options.logger;
    if (!this.session_id) {
      throw new Error("SessionTitleTask requires a non-empty session_id");
    }
  }

  /** 调度标题任务；已有任务或已释放时直接忽略。 */
  schedule(runner: SessionTitleTaskRunner): void {
    if (this.disposed) return;
    if (this.active_task) {
      this.pending_runner = runner;
      return;
    }
    const abort_controller = new AbortController();
    this.abort_controller = abort_controller;
    const task = Promise.resolve()
      .then(async () => await runner(abort_controller.signal))
      .catch(async (error) => {
        if (abort_controller.signal.aborted) return;
        try {
          await this.logger.log("warn", "[agent] session_title.task_failed", {
            session_id: this.session_id,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // 标题诊断日志失败不能影响 Session 主流程。
        }
      })
      .finally(() => {
        if (this.active_task === task) {
          this.active_task = null;
          this.abort_controller = null;
          const pending_runner = this.pending_runner;
          this.pending_runner = null;
          if (pending_runner && !this.disposed) this.schedule(pending_runner);
        }
      });
    this.active_task = task;
  }

  /** 取消当前标题任务并阻止后续结果提交。 */
  cancel(): void {
    this.abort_controller?.abort();
  }

  /** 释放协调器；释放后不再接受新的标题任务。 */
  dispose(): void {
    this.disposed = true;
    this.pending_runner = null;
    this.cancel();
  }
}
