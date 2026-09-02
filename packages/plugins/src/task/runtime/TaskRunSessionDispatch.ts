/**
 * TaskRunSessionDispatch：把 task 最终结果写入关联 Session。
 *
 * Task runtime 不直接依赖 Chat Plugin。消息写入关联 Session 后，
 * 由 Session 自己的消息通知机制向订阅者发布变化。
 */

import type { PluginContext } from "@downcity/agent";
import type { ShipTaskDefinitionV1 } from "@/task/types/Task.js";

function resolve_task_final_text(params: {
  output_text: string;
  error_text: string;
  result_errors: string[];
}): string {
  const output_text = String(params.output_text || "").trim();
  if (output_text) return output_text;

  const error_text = String(params.error_text || "").trim();
  if (error_text) return error_text;

  return params.result_errors
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n");
}

/** 将 task 最终结果追加为关联 Session 的 assistant 消息。 */
export async function dispatchTaskRunCompletionToSession(params: {
  context: PluginContext;
  task: ShipTaskDefinitionV1;
  executionId: string;
  outputText: string;
  errorText: string;
  resultErrors: string[];
}): Promise<void> {
  const delivery_session = params.task.frontmatter.delivery_session;
  if (!delivery_session) return;

  const text = resolve_task_final_text({
    output_text: params.outputText,
    error_text: params.errorText,
    result_errors: params.resultErrors,
  });
  if (!text) return;

  try {
    await params.context.sessions.get(
      delivery_session.session_id,
      delivery_session.origin_type,
    );
    await params.context.sessions.runtime(
      delivery_session.session_id,
      delivery_session.origin_type,
    ).append_assistant_message({ text });
  } catch (error) {
    params.context.logger.warn("[TASK] Task completion Session append failed", {
      taskId: params.task.taskId,
      delivery_session,
      executionId: params.executionId,
      error: String(error),
    });
  }
}
