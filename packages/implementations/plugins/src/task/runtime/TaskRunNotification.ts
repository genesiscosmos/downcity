/**
 * Task Run 终态通知生产器。
 *
 * Task 执行记录是完成事实的唯一来源；本模块只在终态产物落盘后生成宿主通知。
 * 通知失败属于可恢复的附属失败，不能反向改变 Task Run 的执行结果。
 */

import type {
  PluginContext,
  PluginNotificationPublisher,
} from "@downcity/city/plugin";
import type { ShipTaskDefinitionV1, ShipTaskRunStatusV1 } from "@/task/types/Task.js";

/** 发布一次 Task Run 完成或失败通知。 */
export async function publish_task_run_notification(params: {
  /** 当前 Task 所属 Agent 与 Workspace 上下文。 */
  readonly context: PluginContext;
  /** 宿主可选注入的通知发布能力。 */
  readonly notifications?: PluginNotificationPublisher;
  /** 本次执行使用的 Task 定义。 */
  readonly task: ShipTaskDefinitionV1;
  /** 本次执行的最终状态。 */
  readonly status: ShipTaskRunStatusV1;
  /** 本次 Run 目录使用的稳定时间戳。 */
  readonly timestamp: string;
  /** 本次执行的用户可见失败说明。 */
  readonly error_text: string;
  /** 本次执行的结果校验错误。 */
  readonly result_errors: readonly string[];
}): Promise<void> {
  if (!params.notifications || params.status === "skipped") return;
  const title = params.task.frontmatter.title;
  const failure_body = summarize_failure(params.error_text, params.result_errors);
  try {
    await params.notifications.publish({
      topic_key: `task:${params.task.taskId}`,
      title: params.status === "success" ? `${title} 已完成` : `${title} 执行失败`,
      ...(params.status === "failure" && failure_body ? { body: failure_body } : {}),
      route: {
        task_title: title,
        view: "run",
        run_timestamp: params.timestamp,
      },
    });
  } catch (error) {
    params.context.logger.warn("[TASK] Task completion notification failed", {
      taskId: params.task.taskId,
      timestamp: params.timestamp,
      error: String(error),
    });
  }
}

/** 将失败详情裁剪为适合通知展示的单行文本。 */
function summarize_failure(error_text: string, result_errors: readonly string[]): string {
  const source = String(error_text || "").trim()
    || result_errors.map((item) => String(item || "").trim()).filter(Boolean).join("; ");
  return source.replace(/\s+/gu, " ").slice(0, 240);
}
