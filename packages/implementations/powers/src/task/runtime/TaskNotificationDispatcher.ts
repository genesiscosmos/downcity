/**
 * TaskPower 实例的统一通知出口。只接受已经提交的业务事实，两个渠道独立收口，
 * 不持有任务状态，不重试，也不接管宿主渠道生命周期。
 */
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { TaskNotification, TaskNotificationChannel } from "../types/TaskNotification.js";
import type { ShipTaskDefinitionV1 } from "../types/Task.js";

/** 从同一入口整理六类事件的标题和短摘要。 */
export function create_task_notification(
  task: ShipTaskDefinitionV1,
  kind: TaskNotification["kind"],
  event_key: string,
  details: {
    /** 用户可见说明或错误；转换为最多 240 字符的单行摘要。 */
    readonly body?: string;
    /** 具体发生项的稳定身份。 */
    readonly occurrence_id?: string;
    /** 已完成保存的执行记录时间戳。 */
    readonly run_timestamp?: string;
  } = {},
): TaskNotification {
  const labels = { reminder: "到期提醒", review: "结果待验收", success: "执行成功", failure: "执行失败", trigger_failure: "计划执行无法启动", missed: "已错过计划" };
  const body = details.body?.replace(/\s+/gu, " ").trim().slice(0, 240);
  return {
    task_id: task.taskId, event_id: `${kind}:${event_key}`, kind,
    title: `${task.title} ${labels[kind]}`,
    ...(body ? { body } : {}),
    ...(details.occurrence_id ? { occurrence_id: details.occurrence_id } : {}),
    ...(details.run_timestamp ? { run_timestamp: details.run_timestamp } : {}),
  };
}

/** 分别向 City 应用内通知与可选宿主 channel 投递同一个事实。 */
export class TaskNotificationDispatcher implements TaskNotificationChannel {
  constructor(
    /** 延迟解析生命周期，Agent action 和 Scheduler 始终共享一个实例。 */
    private readonly resolve_context: () => PowerLifecycleContext,
    /** 宿主所有的可选展示渠道。 */
    private readonly channel?: TaskNotificationChannel,
  ) {}

  async send(notification: TaskNotification): Promise<void> {
    const context = this.resolve_context();
    const results = await Promise.allSettled([
      Promise.resolve().then(() => context.notifications.publish({
        topic_key: `task:${notification.task_id}`,
        event_id: notification.event_id,
        kind: "update", scope: "inbox",
        outcome: ["failure", "trigger_failure", "missed"].includes(notification.kind) ? "failure" : "success",
        title: notification.title,
        ...(notification.body ? { body: notification.body } : {}),
        route: { task_id: notification.task_id, ...(notification.run_timestamp ? { run_timestamp: notification.run_timestamp } : {}) },
      })),
      Promise.resolve().then(() => this.channel?.send(notification)),
    ]);
    results.forEach((result, index) => {
      if (result.status !== "rejected") return;
      context.logger.warn("[TASK] Task notification delivery failed", {
        task_id: notification.task_id, event_id: notification.event_id,
        channel: index === 0 ? "application" : "host", error: String(result.reason),
      });
    });
  }
}
