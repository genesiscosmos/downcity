/**
 * 单个模型步骤的请求、提交和手动恢复边界。
 *
 * 最终 ModelCall 只构建一次；自动与手动尝试共享同一语义输入。
 * 失败草稿从当前输出撤掉；完整响应落盘后才能执行工具，工具阶段异常不重试模型。
 */
import { model_input_digest } from "./SessionModelInput.js";
import { ModelContextAdvanced } from "./ContextRetry.js";
import type { Logger } from "@/utils/logger/Logger.js";
import { read_model_error } from "@downcity/type";
import { build_model_step_call } from "@/model/ModelStepCall.js";
import { execute_model_request } from "@/model/ModelRequestRunner.js";
import { run_model_step } from "@/model/ModelStepRunner.js";
import { ModelStreamFailure, is_manually_retryable_model_failure } from "@/model/ModelStreamFailure.js";
import { ModelResponseCommitFailure } from "@/model/ModelResponseCommitFailure.js";
import { ResultSaveFailure } from "@/model/results/ResultSaveFailure.js";
import { generate_id } from "@/utils/Id.js";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { SessionStepExecutionInput } from "@/types/session/SessionExecution.js";
import type { SessionModelRetryControl } from "./SessionModelRetry.js";

/** 运行一个冻结输入的模型步骤；恢复不重新调用输入装配器。 */
export async function execute_session_provider_step(input: {
  /** 上限收尾的空响应由执行器按上限失败处理，不扩展模型恢复循环。 */
  allow_empty_response?: boolean;
  /** 原 Turn 上下文，持有输出、审批和停止信号。 */
  turn_context: SessionTurnContext;
  /** 已确定的模型、消息、系统指令和工具绑定。 */
  step_input: SessionStepExecutionInput;
  /** Session 所有的控制屏障；自定义执行器可以省略。 */
  retry_control?: SessionModelRetryControl;
  /** 请求阶段诊断，保持原执行器日志能力。 */
  logger?: Logger;
  /** 识别上下文超限，避免套用普通自动请求重试。 */
  is_context_limit: (error: unknown) => boolean;
  /** 共用 Turn 的有界上下文推进；无法推进时保留本步骤供手动重试。 */
  advance_context?: (error: unknown) => Promise<boolean>;
}): ReturnType<typeof run_model_step> {
  const { turn_context, step_input } = input;
  const signal = turn_context.lifecycle.abort_signal;
  const output = turn_context.output.assistant;
  // 复制协议数据，Provider 或 UI 不得修改下一尝试的请求。工具闭包保留原绑定。
  const call = structuredClone(build_model_step_call(step_input.system, step_input.messages, step_input.tools));
  const step_id = generate_id();
  const validate_input = await input.retry_control?.prepare_input(call, step_input.validate_retry);
  const original_tools = model_input_digest(call.tools);
  const validate = async () => {
    await validate_input?.();
    if (model_input_digest(build_model_step_call(step_input.system, step_input.messages, step_input.tools).tools) !== original_tools) throw new Error("Original tool definitions changed");
  };
  while (true) {
    try {
      return await execute_model_request({
        request_kind: "turn", abort_signal: signal,
        should_retry: error => !input.is_context_limit(error),
        on_failure: async notice => {
          turn_context.output.report_model_request_failure(notice);
        },
        execute_attempt: async model_signal => {
          const attempt_id = generate_id();
          let response_committed = false;
          await output?.begin_step(step_id);
          try {
            const result = await run_model_step({
              ...step_input, allow_empty_response: input.allow_empty_response, call: structuredClone(call), abort_signal: signal, model_abort_signal: model_signal,
              ...(output ? { assistant_output: output } : {}),
              on_diagnostic: diagnostic => input.logger?.log("info", `[agent] model_request.${diagnostic.phase}`, {
                session_id: turn_context.session.session_id, turn_id: turn_context.session.turn_id,
                invocation_id: attempt_id, model_id: step_input.model.id, ...diagnostic,
              }),
              on_response_committed: async () => { response_committed = true; },
            });
            return result;
          } catch (error) {
            // 提交结果未知先回滚到权威快照，保留可能已经落盘的成功响应，禁止再生成。
            if (error instanceof ModelResponseCommitFailure) {
              await output?.abort_step();
              throw error;
            }
            // 工具执行或保存异常绝不被包装成模型失败。
            if (!response_committed) {
              await output?.abort_step();
            }
            if (error instanceof ResultSaveFailure) throw error;
            throw error;
          }
        },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof ModelStreamFailure)) throw error;
      if (!output?.show_model_error || !output.clear_model_error || !input.retry_control) throw error;
      if (input.is_context_limit(error) && await input.advance_context?.(error)) {
        throw new ModelContextAdvanced();
      }
      const model_error = read_model_error(error)!;
      if (!is_manually_retryable_model_failure(model_error)) throw error;
      const error_part_id = `error:${generate_id()}`;
      await input.retry_control.wait(
        () => output.show_model_error!(error_part_id, model_error),
        () => output.clear_model_error!(error_part_id), signal, validate,
      );
      // 原执行栈继续使用冻结请求；不追加消息或恢复提示词。
    }
  }
}
