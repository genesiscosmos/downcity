/**
 * ActionSchedule Runtime：plugin action 延迟执行的轮询运行时。
 *
 * 关键点（中文）
 * - ActionSchedule 不是 plugin，因此不出现在 plugin 列表、状态和 lifecycle 中。
 * - 这里只跟随 Agent 长期运行生命周期启动，用于消费持久化的 action schedule 任务。
 * - 普通 plugin 先启动，ActionSchedule 再开始轮询，避免到期 action 执行到未启动的 plugin。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import { run_due_action_schedule_jobs } from "@/plugin/core/ActionScheduleExecutor.js";
import { ActionScheduleStore } from "@/plugin/core/ActionScheduleStore.js";

const ACTION_SCHEDULE_POLL_INTERVAL_MS = 1_000;
const ACTION_SCHEDULE_LOG_PREFIX = "[ACTION_SCHEDULE]";

function formatActionScheduleLogMessage(message: string): string {
  return `${ACTION_SCHEDULE_LOG_PREFIX} ${message}`;
}

/**
 * ActionSchedule runtime 停止句柄。
 */
export interface ActionScheduleRuntimeHandle {
  /**
   * 停止轮询并释放持久化存储资源。
   */
  stop(): void;
}

/**
 * 启动 ActionSchedule 轮询 runtime。
 */
export async function start_action_schedule_runtime(
  context: PluginContext,
): Promise<ActionScheduleRuntimeHandle> {
  const store = new ActionScheduleStore(context.files);
  const recovered = await store.reset_running_jobs_to_pending();
  if (recovered > 0) {
    context.logger.warn(
      formatActionScheduleLogMessage("Recovered interrupted running jobs"),
      { recovered },
    );
  }

  let ticking = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await run_due_action_schedule_jobs({
        context,
        store,
      });
    } finally {
      ticking = false;
    }
  };

  await tick();
  timer = setInterval(() => {
    void tick();
  }, ACTION_SCHEDULE_POLL_INTERVAL_MS);

  context.logger.info(formatActionScheduleLogMessage("Runtime started"));

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      store.close();
      context.logger.info(formatActionScheduleLogMessage("Runtime stopped"));
    },
  };
}
