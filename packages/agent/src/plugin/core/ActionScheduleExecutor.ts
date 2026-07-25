/**
 * ActionSchedule 到期执行器。
 *
 * 关键点（中文）
 * - 只负责“把到点的 action schedule 任务执行掉并更新状态”。
 * - 不负责调度入口、持久化初始化和轮询生命周期管理。
 * - 到期后重新走 `run_plugin_command`，复用 plugin action 的统一执行规则。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { ActionScheduleStore } from "@/plugin/core/ActionScheduleStore.js";
import { run_plugin_command } from "@/plugin/core/PluginActionRunner.js";

/**
 * 执行当前已到点的 pending 任务。
 */
export async function run_due_action_schedule_jobs(params: {
  context: PluginContext;
  store: ActionScheduleStore;
}): Promise<void> {
  const dueJobs = await params.store.list_due_pending_jobs(Date.now());
  for (const job of dueJobs) {
    const claimed = await params.store.mark_job_running(job.id);
    if (!claimed) continue;

    try {
      const result = await run_plugin_command({
        plugin_name: job.plugin_name,
        command: job.action_name,
        payload: job.payload,
        context: params.context,
      });
      if (!result.success) {
        await params.store.mark_job_failed(
          job.id,
          result.message || "scheduled action failed",
        );
        params.context.logger.warn("[action-schedule] job failed", {
          job_id: job.id,
          plugin_name: job.plugin_name,
          action_name: job.action_name,
          error: result.message || "scheduled action failed",
        });
        continue;
      }

      await params.store.mark_job_succeeded(job.id);
    } catch (error) {
      await params.store.mark_job_failed(job.id, String(error));
      params.context.logger.warn("[action-schedule] job failed", {
        job_id: job.id,
        plugin_name: job.plugin_name,
        action_name: job.action_name,
        error: String(error),
      });
    }
  }
}
