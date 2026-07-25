/**
 * ActionSchedule 到期执行器。
 *
 * 关键点（中文）
 * - 只负责“把到点的 action schedule 任务执行掉并更新状态”。
 * - 不负责调度入口、持久化初始化和轮询生命周期管理。
 * - 到期后重新走 `runPluginCommand`，复用 plugin action 的统一执行规则。
 */

import type { AgentContext } from "@/agent/AgentContext.js";
import type { ActionScheduleStore } from "@/plugin/core/ActionScheduleStore.js";
import { runPluginCommand } from "@/plugin/core/PluginActionRunner.js";

/**
 * 执行当前已到点的 pending 任务。
 */
export async function runDueActionScheduleJobs(params: {
  context: AgentContext;
  store: ActionScheduleStore;
}): Promise<void> {
  const dueJobs = await params.store.listDuePendingJobs(Date.now());
  for (const job of dueJobs) {
    const claimed = await params.store.markJobRunning(job.id);
    if (!claimed) continue;

    try {
      const result = await runPluginCommand({
        pluginName: job.pluginName,
        command: job.actionName,
        payload: job.payload,
        context: params.context,
      });
      if (!result.success) {
        await params.store.markJobFailed(
          job.id,
          result.message || "scheduled action failed",
        );
        params.context.logger.warn("[action-schedule] job failed", {
          jobId: job.id,
          pluginName: job.pluginName,
          actionName: job.actionName,
          error: result.message || "scheduled action failed",
        });
        continue;
      }

      await params.store.markJobSucceeded(job.id);
    } catch (error) {
      await params.store.markJobFailed(job.id, String(error));
      params.context.logger.warn("[action-schedule] job failed", {
        jobId: job.id,
        pluginName: job.pluginName,
        actionName: job.actionName,
        error: String(error),
      });
    }
  }
}
