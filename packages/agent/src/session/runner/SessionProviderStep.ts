/**
 * 单个模型步骤的请求、提交和手动恢复边界。
 *
 * 最终 ModelCall 只构建一次；自动与手动尝试共享同一语义输入。
 * 失败草稿只进入诊断记录；完整响应落盘后才能执行工具，工具阶段异常不重试模型。
 */
import { model_input_digest } from "./SessionModelInput.js";
import type { Logger } from "@/utils/logger/Logger.js";
import { read_model_error, type SessionModelRetry, type ModelStreamEvent } from "@downcity/type";
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

/** 不可直接恢复的错误给出具体处理条件，不作为提示词传给模型。 */
function model_retry_remedy(code: string): string | undefined {
  if (code === "authentication_failed") return "Fix provider credentials, then start a new request.";
  if (code === "permission_denied") return "Check account permissions and access to this model, then start a new request.";
  if (code === "model_unavailable") return "Select an available model before starting a new request.";
  if (code === "invalid_request") return "Correct model parameters or tool definitions before starting a new request.";
  if (code === "context_length_exceeded") return "Reduce or compact the conversation before starting a new request.";
  if (code === "content_rejected") return "Review the request rejected by the provider before starting a new request.";
  return undefined;
}

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
  /** 上下文错误交回现有压缩流程，不允许原样手动重试。 */
  is_context_limit: (error: unknown) => boolean;
}): ReturnType<typeof run_model_step> {
  const { turn_context, step_input } = input;
  const signal = turn_context.lifecycle.abort_signal;
  const output = turn_context.output.assistant;
  // 复制协议数据，Provider 或 UI 不得修改下一尝试的请求。工具闭包保留原绑定。
  const call = structuredClone(build_model_step_call(step_input.system, step_input.messages, step_input.tools));
  let record: SessionModelRetry = {
    turn_id: turn_context.session.turn_id, step_id: generate_id(), model_id: step_input.model.id,
    status: "running", recoverable: false, attempts: [], receipts: [],
  };
  const prepared = input.retry_control && output?.save_model_input
    ? await input.retry_control.prepare_input(record, call, output, value => turn_context.interactions?.redact_secret_values(value) ?? value, step_input.validate_retry)
    : undefined;
  if (prepared) record = { ...record, input_part_id: prepared.input_part_id };
  const original_tools = model_input_digest(call.tools);
  const validate = async () => {
    await prepared?.validate();
    if (model_input_digest(build_model_step_call(step_input.system, step_input.messages, step_input.tools).tools) !== original_tools) throw new Error("Original tool definitions changed");
  };
  const save = async (next: SessionModelRetry): Promise<string> => {
    if (!output?.save_model_retry) throw new Error("Model retry persistence unavailable");
    const message_id = await output.save_model_retry((turn_context.interactions?.redact_secret_values(next) ?? next) as SessionModelRetry);
    record = structuredClone(next);
    return message_id;
  };
  while (true) {
    try {
      return await execute_model_request({
        request_kind: "turn", abort_signal: signal,
        should_retry: error => !input.is_context_limit(error),
        on_failure: async notice => {
          turn_context.output.report_model_request_failure(notice);
          record = { ...record, status: notice.will_retry ? "running" : "failed", recoverable: false };
          if (output?.save_model_retry) await save(record);
        },
        execute_attempt: async model_signal => {
          const attempt_id = generate_id();
          const started_at = Date.now();
          let partial_text = "";
          let partial_reasoning = "";
          let response_committed = false;
          let committed_record: SessionModelRetry | undefined;
          record = { ...record, status: "running", recoverable: false, active_attempt: { attempt_id, started_at } };
          if (output?.save_model_retry) await save(record);
          await output?.begin_step(record.step_id);
          try {
            const result = await run_model_step({
              ...step_input, allow_empty_response: input.allow_empty_response, call: structuredClone(call), abort_signal: signal, model_abort_signal: model_signal,
              ...(output ? { assistant_output: output } : {}),
              on_diagnostic: diagnostic => input.logger?.log("info", `[agent] model_request.${diagnostic.phase}`, {
                session_id: turn_context.session.session_id, turn_id: record.turn_id,
                invocation_id: attempt_id, model_id: record.model_id, ...diagnostic,
              }),
              on_event: (event: ModelStreamEvent) => {
                if (event.type === "text_delta") partial_text += event.delta;
                if (event.type === "reasoning_delta") partial_reasoning += event.delta;
              },
              prepare_response_commit: () => {
                committed_record = { ...record, active_attempt: undefined, status: "succeeded", recoverable: false, attempts: [...record.attempts, {
                  attempt_id, started_at, ended_at: Date.now(), outcome: "committed",
                }] };
                return (turn_context.interactions?.redact_secret_values(committed_record) ?? committed_record) as SessionModelRetry;
              },
              on_response_committed: async () => { response_committed = true; record = committed_record!; },
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
              if (error instanceof ModelStreamFailure) {
                const model_error = read_model_error(error)!;
                record = { ...record, active_attempt: undefined, reason: model_retry_remedy(model_error.code), status: signal.aborted ? "stopped" : "failed",
                  recoverable: false,
                  attempts: [...record.attempts, { attempt_id, started_at, ended_at: Date.now(),
                    outcome: signal.aborted ? "stopped" : "failed", error: model_error,
                    ...(partial_text ? { partial_text } : {}), ...(partial_reasoning ? { partial_reasoning } : {}),
                  }],
                };
              }
            }
            if (signal.aborted && !response_committed) {
              record = { ...record, status: "stopped", recoverable: false, active_attempt: undefined,
                attempts: record.attempts.some(item => item.attempt_id === attempt_id) ? record.attempts : [...record.attempts, {
                  attempt_id, started_at, ended_at: Date.now(), outcome: "stopped",
                  ...(partial_text ? { partial_text } : {}), ...(partial_reasoning ? { partial_reasoning } : {}),
                }] };
            }
            if (output?.save_model_retry && !response_committed) await save(record);
            if (error instanceof ResultSaveFailure) throw error;
            throw error;
          }
        },
      });
    } catch (error) {
      if (signal.aborted) {
        if (output?.save_model_retry && record.status !== "succeeded") await save({ ...record, status: "stopped", recoverable: false });
        throw error;
      }
      if (!(error instanceof ModelStreamFailure) || input.is_context_limit(error)) throw error;
      if (!output?.save_model_retry || !input.retry_control) throw error;
      record = { ...record, status: "failed", recoverable: is_manually_retryable_model_failure(record.attempts.at(-1)?.error) };
      if (!record.recoverable) { await save(record); throw error; }
      await input.retry_control.wait(record, save, signal, validate);
      // 已接收控制记录包含 request_id，save 回调已刷新 record；不会追加恢复提示词。
    }
  }
}
