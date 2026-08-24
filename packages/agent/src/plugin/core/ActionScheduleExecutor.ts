/**
 * ActionSchedule 到期执行器。
 *
 * 关键点（中文）
 * - 只负责“把到点的 action schedule 任务执行掉并更新状态”。
 * - 不负责调度入口、持久化初始化和轮询生命周期管理。
 * - 到期后直接走 Plugin Registry Action 执行入口。
 */

import type { ActionScheduleStore } from "@/plugin/core/ActionScheduleStore.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";

/**
 * 执行当前已到点的 pending 任务。
 */
export async function run_due_action_schedule_jobs(params: {
  store: ActionScheduleStore;
  resolve_context: (workspace_id?: string) => PluginContext | null;
  logger: Pick<PluginContext["logger"], "warn">;
}): Promise<void> {
  const dueJobs = await params.store.list_due_pending_jobs(Date.now());
  for (const job of dueJobs) {
    const claimed = await params.store.mark_job_running(job.id);
    if (!claimed) continue;

    try {
      const context = params.resolve_context(job.workspace_id);
      if (!context) {
        const error = `Workspace "${job.workspace_id}" is not active`;
        await params.store.mark_job_failed(job.id, error);
        params.logger.warn("[action-schedule] job failed", {
          job_id: job.id,
          workspace_id: job.workspace_id,
          error,
        });
        continue;
      }
      const result = await context.plugins.run_action({
        plugin: job.plugin_name,
        action: job.action_name,
        payload: job.payload ?? undefined,
      });
      if (!result.success) {
        await params.store.mark_job_failed(
          job.id,
          result.error || result.message || "scheduled action failed",
        );
        params.logger.warn("[action-schedule] job failed", {
          job_id: job.id,
          plugin_name: job.plugin_name,
          action_name: job.action_name,
          error: result.error || result.message || "scheduled action failed",
        });
        continue;
      }

      await params.store.mark_job_succeeded(job.id);
    } catch (error) {
      await params.store.mark_job_failed(job.id, String(error));
      params.logger.warn("[action-schedule] job failed", {
        job_id: job.id,
        plugin_name: job.plugin_name,
        action_name: job.action_name,
        error: String(error),
      });
    }
  }
}
