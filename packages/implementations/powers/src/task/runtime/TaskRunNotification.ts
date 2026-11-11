/** 提交后的执行通知边界；任何渠道同步或异步异常均不能进入执行失败分支。 */
import type { PowerContext } from "@downcity/city/power";
import type { TaskNotification, TaskNotificationChannel } from "../types/TaskNotification.js";

/** 尽力投递已经结算的执行事件。 */
export async function publish_task_run_notification(
  context: PowerContext,
  channel: TaskNotificationChannel | undefined,
  notification: TaskNotification,
): Promise<void> {
  try {
    await channel?.send(notification);
  } catch (error) {
    context.logger.warn("[TASK] Task notification failed", {
      task_id: notification.task_id, event_id: notification.event_id, error: String(error),
    });
  }
}
