/**
 * 执行结束后的消息与完成日志提交边界。
 *
 * 必要维护成功后才准备权威 Turn 结果；错误展示、文件摘要或消息收口失败由 Loop
 * 与执行阶段的原始失败组合，不能悄悄变成成功或重新执行模型。
 */
import { append_session_turn_file_diff } from "./SessionTurnFileDiff.js";
import { prepare_session_completion } from "./SessionCompletionJournal.js";
import type { ActiveSessionTurnState } from "@/types/session/SessionLoop.js";
import type { SessionTurnExecutionResult } from "@/types/session/SessionExecution.js";
import type { SessionTurnCompletionOptions } from "@/types/session/SessionTurnCompletion.js";

/** 在输入已结算且接收已关闭后提交 Turn 的必要收尾。 */
export async function finalize_session_execution(
  options: SessionTurnCompletionOptions,
  active: ActiveSessionTurnState,
  result: SessionTurnExecutionResult,
  workspace_path: string,
  maintain: () => Promise<void>,
): Promise<void> {
  const turn_context = active.turn_context!;
  const assistant_output = turn_context.output.assistant!;
  if (!result.success && !turn_context.lifecycle.abort_signal.aborted && result.error
    && !(await options.messages.read_latest_agent_message(active.turn_id))?.current_error) {
    await assistant_output.append_error({ scope: "turn", code: result.error_code || "turn_execution_failed",
      message: result.error, recoverable: false });
  }
  await append_session_turn_file_diff({
    session_id: options.session_id, turn_id: active.turn_id, workspace_path,
    turn_context, assistant_output, logger: options.logger,
  });
  await maintain();
  // 只投影可序列化结果；进程内 failure 不写入完成日志。
  await prepare_session_completion(options, active, {
    turn_id: active.turn_id, text: result.text, success: result.success,
    ...(result.error ? { error: result.error } : {}),
  });
  await assistant_output.finish({
    status: turn_context.lifecycle.abort_signal.aborted ? "stopped" : result.success ? "completed" : "failed",
    ...(result.error ? { error: result.error } : {}),
  });
}
