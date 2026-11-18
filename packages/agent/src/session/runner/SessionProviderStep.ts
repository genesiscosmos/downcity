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
import type { SessionModelRetryControl } from "./SessionModelReplay.js";

/** 运行一个冻结输入的模型步骤；恢复不重新调用输入装配器。 */
export async function execute_session_provider_step(input: {
  /** 失败步骤保留成功正文和预算，不持有运行资源。 */
  checkpoint: import("@/types/session/SessionModelInput.js").SessionStepCheckpoint;
  /** 上限收尾的空响应由执行器按上限失败处理，不扩展模型恢复循环。 */
  allow_empty_response?: boolean;
  /** 本次 Turn 上下文，持有输出、审批和停止信号。 */
  turn_context: SessionTurnContext;
  /** 已确定的模型、消息、系统指令和工具绑定。 */
  step_input: SessionStepExecutionInput;
  /** Session 所有的闲置请求缓存；自定义执行器可以省略。 */
  retry_control?: SessionModelRetryControl;
  /** 请求阶段诊断，保持原执行器日志能力。 */
  logger?: Logger;
  /** 识别上下文超限，避免套用普通自动请求重试。 */
  is_context_limit: (error: unknown) => boolean;
  /** 共用 Turn 的有界上下文推进；无法推进时失败结束。 */
  advance_context?: (error: unknown) => Promise<boolean>;
}): ReturnType<typeof run_model_step> {
  const { turn_context, step_input } = input;
  const signal = turn_context.lifecycle.abort_signal;
  signal.throwIfAborted();
  const output = turn_context.output.assistant;
  // 复制协议数据，Provider 或 UI 不得修改下一尝试的请求。
  const call = structuredClone(step_input.call ?? build_model_step_call(step_input.system, step_input.messages, step_input.tools));
  if (step_input.call && model_input_digest(call.tools) !== model_input_digest(build_model_step_call([], [], step_input.tools).tools)) {
    throw new Error("Original tool definitions changed");
  }
  const step_id = step_input.retry_step_id ?? generate_id();
  const prepared = await input.retry_control?.prepare_input(call, step_input.validate_retry);
  if (step_input.call) {
    await step_input.validate_replay?.();
    if (prepared && !prepared.current()) throw new Error("Session input changed");
  }
  signal.throwIfAborted();
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
    if (!output?.show_model_error || !input.retry_control) throw error;
    if (input.is_context_limit(error) && await input.advance_context?.(error)) {
      throw new ModelContextAdvanced();
    }
    const model_error = read_model_error(error)!;
    if (!is_manually_retryable_model_failure(model_error)) throw error;
    const error_part_id = `error:${generate_id()}`;
    const binding = await output.show_model_error(error_part_id, model_error);
    if (prepared?.current() && step_input.rebind_retry && !signal.aborted) {
      input.retry_control.capture({ binding, call, validate: prepared.validate,
        turn_id: turn_context.session.turn_id, step_id, checkpoint: structuredClone(input.checkpoint),
        bind: replay_step_binding(step_input.rebind_retry, call.tools?.map(tool => tool.name) ?? [], step_input.finalization),
      });
    }
    throw error;
  }
}

/** 只捕获工具名字和无 Turn 的工厂；工具裁剪与收尾约束同样属于原请求。 */
function replay_step_binding(bind: NonNullable<SessionStepExecutionInput["rebind_retry"]>, names: readonly string[], finalization?: boolean): NonNullable<SessionStepExecutionInput["rebind_retry"]> {
  return async context => {
    const next = await bind(context);
    return { ...next, finalization, tools: Object.fromEntries(Object.entries(next.tools).filter(([name]) => names.includes(name))) };
  };
}
