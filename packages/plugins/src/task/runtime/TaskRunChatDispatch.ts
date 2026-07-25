/**
 * TaskRunChatDispatch：task 执行完成后的 chat 回发模块。
 *
 * 关键点（中文）
 * - task 完成后统一通过 chat plugin runtime 的 `send` action 回发结果。
 * - 默认只发送最终结果正文，不额外包裹标题/状态摘要。
 * - 回发失败只记录日志，不影响 task run 自身状态。
 */

import type { PluginContext } from "@downcity/agent";
import type { ShipTaskDefinitionV1 } from "@/task/types/Task.js";

function resolveTaskFinalText(params: {
  outputText: string;
  errorText: string;
  resultErrors: string[];
}): string {
  const outputText = String(params.outputText || "").trim();
  if (outputText) return outputText;

  const errorText = String(params.errorText || "").trim();
  if (errorText) return errorText;

  const resultErrors = params.resultErrors
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (resultErrors.length > 0) {
    return resultErrors.join("\n");
  }

  return "";
}

/**
 * 通过 chat plugin runtime 发送 task 最终结果。
 */
export async function dispatchTaskRunCompletionToChat(params: {
  context: PluginContext;
  task: ShipTaskDefinitionV1;
  executionId: string;
  outputText: string;
  errorText: string;
  resultErrors: string[];
}): Promise<void> {
  const session_id = String(params.task.frontmatter.session_id || "").trim();
  if (!session_id) return;

  const finalText = resolveTaskFinalText({
    outputText: params.outputText,
    errorText: params.errorText,
    resultErrors: params.resultErrors,
  });
  if (!finalText) return;

  try {
    const sent = await params.context.plugins.run_action({
      plugin: "chat",
      action: "send",
      payload: {
        chat_key: session_id,
        text: finalText,
        reply_to_message: true,
      },
    });
    if (!sent.success) {
      params.context.logger.warn("[TASK] Task completion chat send failed", {
        taskId: params.task.taskId,
        session_id,
        executionId: params.executionId,
        error: sent.error || "chat send failed",
      });
    }
  } catch (error) {
    params.context.logger.warn("[TASK] Task completion chat send failed", {
      taskId: params.task.taskId,
      session_id,
      executionId: params.executionId,
      error: String(error),
    });
  }
}
