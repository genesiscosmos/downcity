/**
 * CoreEngineRunner：模型与 tool-loop 主循环执行器。
 *
 * 关键点（中文）
 * - 每个 Provider Step 都通过回调取得 Composer 生成的完整输入。
 * - 只负责 step 循环、续写恢复与最终 assistant 汇总，不持有历史副本。
 * - 保持失败返回结构稳定，避免对外 Session 行为变化。
 */

import type { RuntimeTool as Tool } from "@downcity/type";
import { log_assistant_message_now } from "@executor/messages/SessionMessageLog.js";
import {
  MAX_INCOMPLETE_RESPONSE_RECOVERIES,
  MAX_TOOL_LOOP_STEPS,
  TOOL_LOOP_MAX_STEPS_ERROR_CODE,
  build_incomplete_response_recovery_nudge,
  build_max_steps_error_text,
  build_max_steps_finalization_nudge,
  detect_incomplete_response,
  extract_assistant_text,
  merge_assistant_parts,
  summarize_assistant_parts_for_debug,
  summarize_step_for_debug,
  to_inline_preview,
} from "@executor/core-engine/CoreEngineSignals.js";
import {
  evaluate_core_engine_loop_decision,
  should_continue_for_tail_merged_user_messages,
} from "@executor/core-engine/CoreEngineLoopDecision.js";
import {
  resolve_effective_core_engine_error,
} from "@executor/core-engine/CoreEngineError.js";
import {
  run_model_step,
  type ModelStepResult,
  type ModelStepToolCall,
} from "@executor/model/ModelStepRunner.js";
import { execute_model_request } from "@executor/model/ModelRequestRunner.js";
import {
  resolve_model_usage_ratio,
  should_compact_after_usage,
} from "@executor/core-engine/CoreEngineContextCompaction.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import { to_session_json_value } from "@/session/messages/SessionJsonValue.js";
import type {
  SessionStepExecutionInput,
  SessionTurnExecutionResult,
} from "@/types/session/SessionExecution.js";
import type { SessionAgentMessagePart } from "@downcity/type";
import { SESSION_APPROVAL_RESPONSE_SCHEMA } from "@downcity/type";
import { create_session_agent_content_part } from "@/session/messages/SessionAgentContent.js";
import { generate_id } from "@/utils/Id.js";

const TURN_STOPPED_MESSAGE = "Turn stopped";

interface CoreEngineRunnerOptions {
  /** 当前 Session 稳定标识。 */
  session_id: string;

  /**
   * 当前 session 统一日志器。
   */
  logger: Logger;

  /**
   * 判断某次执行错误是否应该上抛给外层压缩重试。
   */
  should_compact_on_error: (error: unknown) => boolean;
}

interface CoreEngineTurnInput {
  /**
   * 当前显式运行上下文。
   */
  turn_context: SessionTurnContext;

  /**
   * 在统一输入队列提交后解析当前 Session step 的 effective 配置。
   */
  resolve_step_input: () => Promise<SessionStepExecutionInput>;
}

/**
 * 模型与 tool-loop 主循环执行器。
 */
export class CoreEngineRunner {
  private readonly session_id: string;
  private readonly logger: Logger;
  private readonly should_compact_on_error: CoreEngineRunnerOptions["should_compact_on_error"];

  constructor(options: CoreEngineRunnerOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.logger = options.logger;
    this.should_compact_on_error = options.should_compact_on_error;
    if (!this.session_id) {
      throw new Error("CoreEngineRunner requires a non-empty session_id");
    }
  }

  /**
   * 执行一次已装配完成的模型/tool-loop 运行。
   */
  async execute(input: CoreEngineTurnInput): Promise<SessionTurnExecutionResult> {
    const start_time = Date.now();
    const session_id = this.session_id;
    let last_observed_stream_error: unknown = undefined;
    let final_assistant_parts: SessionAgentMessagePart[] = [];
    let compact_required = false;

    try {
      let step_count = 0;
      let total_tool_call_count = 0;
      let total_tool_result_count = 0;
      const on_step_finish = async (
        step_result: ModelStepResult,
      ): Promise<void> => {
        step_count += 1;
        const summary = summarize_step_for_debug(step_result);
        total_tool_call_count +=
          typeof summary.toolCallCount === "number" ? summary.toolCallCount : 0;
        total_tool_result_count +=
          typeof summary.toolResultCount === "number"
            ? summary.toolResultCount
            : 0;
        await this.logger.log("info", "[agent] step.finish", {
          session_id: session_id,
          step_index: step_count,
          ...summary,
        });
      };

      let incomplete_response_recovery_count = 0;
      while (step_count < MAX_TOOL_LOOP_STEPS) {
        // 关键点（中文）：steer 与 command 在同一个 Session step 检查点执行。
        // 当前流与 tool callback 保持原执行视图，下一 step 再统一读取 effective 配置。
        await input.turn_context.input.checkpoint();
        const step_input = await input.resolve_step_input();

        last_observed_stream_error = undefined;
        const step = await this.execute_provider_step({
          turn_context: input.turn_context,
          step_input,
          on_step_finish,
        });
        const step_assistant_parts = step.step_assistant_parts;
        const step_result = step.step_result;
        final_assistant_parts = merge_assistant_parts(
          final_assistant_parts,
          step_assistant_parts,
        );

        const usage_ratio = resolve_model_usage_ratio(
          step_result.usage,
          step_input.context_window,
        );
        if (usage_ratio !== null) {
          const pressure_detected = should_compact_after_usage(usage_ratio);
          if (pressure_detected) compact_required = true;
          await this.logger.log("info", "[agent] context.usage", {
            session_id: session_id,
            step_index: step_count,
            usageRatio: usage_ratio,
            contextWindow: step_input.context_window,
            compactPending: pressure_detected,
          });
        }

        const incomplete_response = detect_incomplete_response({
          step_result,
          assistant_parts: step_assistant_parts,
        });
        const loop_decision = evaluate_core_engine_loop_decision({
          hasIncompleteResponse: incomplete_response !== null,
          incompleteRecoveryCount: incomplete_response_recovery_count,
          maxIncompleteRecoveries: MAX_INCOMPLETE_RESPONSE_RECOVERIES,
          toolCallCount: step_result.tool_calls.length,
        });

        await this.logger.log("info", "[agent] loop.decision", {
          session_id: session_id,
          step_index: step_count,
          continueForToolCalls: loop_decision.continueForToolCalls,
          continueForIncompleteRecovery:
            loop_decision.continueForIncompleteRecovery,
          decisionKind: loop_decision.kind,
          incompleteResponseReason: incomplete_response?.reason ?? null,
          incompleteResponseRecoveryCount: incomplete_response_recovery_count,
          toolCallCount: step_result.tool_calls.length,
          toolResultCount: step_result.tool_results.length,
          finishReason: step_result.finish_reason,
          textPreview: to_inline_preview(step_result.text),
        });

        if (
          loop_decision.continueForIncompleteRecovery &&
          incomplete_response
        ) {
          incomplete_response_recovery_count += 1;
          await this.logger.log("warn", "[agent] incomplete_response.recover", {
            session_id: session_id,
            step_index: step_count,
            recoveryCount: incomplete_response_recovery_count,
            reason: incomplete_response.reason,
            ...incomplete_response.details,
          });
          await input.turn_context.input.append_internal([{
              type: "text",
              text: build_incomplete_response_recovery_nudge(
                incomplete_response_recovery_count,
              ),
            }]);
          continue;
        }

        if (incomplete_response) {
          await this.logger.log("error", "[agent] incomplete_response", {
            session_id: session_id,
            step_index: step_count,
            reason: incomplete_response.reason,
            recoveryCount: incomplete_response_recovery_count,
            ...incomplete_response.details,
          });
          throw new Error(
            `Agent received incomplete response (${incomplete_response.reason})`,
          );
        }

        if (loop_decision.continueForToolCalls) {
          incomplete_response_recovery_count = 0;
          continue;
        }

        // 关键点（中文）：stop 前做 tail merge，覆盖最后一个 step 后才入队的新 user 消息。
        const tail_merged_message_count = input.turn_context.input.has_pending()
          ? 1
          : 0;
        if (
          should_continue_for_tail_merged_user_messages({
            mergedUserMessageCount: tail_merged_message_count,
          })
        ) {
          incomplete_response_recovery_count = 0;
          await this.logger.log("info", "[agent] loop.tail_merge_continue", {
            session_id: session_id,
            step_index: step_count,
            mergedUserMessageCount: tail_merged_message_count,
          });
          continue;
        }

        break;
      }

      // 关键点（中文）：撞顶不再静默成功收口——先强制收尾一次，再决定成功或明确失败。
      let max_steps_reached = false;
      let finalization_produced_text = false;
      if (step_count >= MAX_TOOL_LOOP_STEPS) {
        max_steps_reached = true;
        await this.logger.log("warn", "[agent] loop.max_steps_reached", {
          session_id: session_id,
          stepCount: step_count,
          maxSteps: MAX_TOOL_LOOP_STEPS,
          totalToolCallCount: total_tool_call_count,
          totalToolResultCount: total_tool_result_count,
        });
        const finalization = await this.execute_max_steps_finalization({
          turn_context: input.turn_context,
          resolve_step_input: input.resolve_step_input,
          on_step_finish,
        });
        final_assistant_parts = merge_assistant_parts(
          final_assistant_parts,
          finalization.assistant_parts,
        );
        finalization_produced_text = finalization.produced_text;
      }

      // 撞顶且收尾失败时不伪造兜底正文，改由 Session 层写入 canonical Error Part。
      const final_parts = final_assistant_parts.length > 0
        ? final_assistant_parts
        : max_steps_reached
          ? []
          : build_fallback_assistant_parts("Execution completed");

      await this.logger.log("info", "[agent] final.message", {
        session_id: session_id,
        ...summarize_assistant_parts_for_debug(final_parts),
      });
      await log_assistant_message_now(this.logger, final_parts);

      if (max_steps_reached && !finalization_produced_text) {
        await this.logger.log("error", "[agent] loop.max_steps_exhausted", {
          session_id: session_id,
          stepCount: step_count,
          maxSteps: MAX_TOOL_LOOP_STEPS,
          totalToolCallCount: total_tool_call_count,
          totalToolResultCount: total_tool_result_count,
        });
        return {
          success: false,
          text: extract_assistant_text(final_parts),
          error: build_max_steps_error_text(MAX_TOOL_LOOP_STEPS),
          error_code: TOOL_LOOP_MAX_STEPS_ERROR_CODE,
          ...(compact_required ? { compact_required: true } : {}),
        };
      }

      const duration = Date.now() - start_time;
      await this.logger.log("info", "[agent] finish", {
        session_id: session_id,
        duration,
        stepCount: step_count,
        totalToolCallCount: total_tool_call_count,
        totalToolResultCount: total_tool_result_count,
      });

      return {
        success: true,
        text: extract_assistant_text(final_parts),
        ...(compact_required ? { compact_required: true } : {}),
      };
    } catch (error) {
      if (input.turn_context.lifecycle.abort_signal.aborted) {
        const error_text = TURN_STOPPED_MESSAGE;
        await this.logger.log("info", "[agent] stopped", {
          session_id: session_id,
        });
        return {
          success: false,
          text: extract_assistant_text(final_assistant_parts),
          error: error_text,
          ...(compact_required ? { compact_required: true } : {}),
        };
      }

      if (this.should_compact_on_error(error)) {
        throw error;
      }

      const error_text = resolve_effective_core_engine_error({
        error,
        streamError: last_observed_stream_error,
      });

      await this.logger.log("error", "CoreEngine execution failed", {
        error: error_text,
      });

      return {
        success: false,
        text: extract_assistant_text(final_assistant_parts),
        error: error_text,
        ...(compact_required ? { compact_required: true } : {}),
      };
    }
  }

  /**
   * 执行一次 Provider Step，并把 canonical 输出写回 Session。
   *
   * 关键点（中文）
   * - 正常 tool-loop 与撞顶收尾共用这一条 Step 路径，落盘顺序完全一致。
   * - 只负责单个 Step；循环决策、计数器与最终 Parts 合并仍由调用方拥有。
   */
  private async execute_provider_step(input: {
    /** 当前显式运行上下文。 */
    turn_context: SessionTurnContext;
    /** 当前 Step 已装配完成的模型输入。 */
    step_input: SessionStepExecutionInput;
    /** 覆盖本 Step 的工具集合；撞顶收尾时传空表以禁止继续调用工具。 */
    tools_override?: Record<string, Tool>;
    /** 合并本 Step 的计数与诊断日志。 */
    on_step_finish: (step_result: ModelStepResult) => Promise<void>;
  }): Promise<{
    /** 本 Step 的稳定运行结果。 */
    step_result: ModelStepResult;
    /** 本 Step 合并 Action 内容后的 canonical Assistant Parts。 */
    step_assistant_parts: SessionAgentMessagePart[];
  }> {
    const turn_context = input.turn_context;
    const result = await execute_model_request({
      request_kind: "turn",
      abort_signal: turn_context.lifecycle.abort_signal,
      should_retry: (error) => !this.should_compact_on_error(error),
      on_failure: async (notice, error) => {
        const is_compact_error = this.should_compact_on_error(error);
        turn_context.output.report_model_request_failure({
          ...notice,
          ...(is_compact_error
            ? {
                attempt: 1,
                max_attempts: 1,
                will_retry: false,
              }
            : {}),
        });
        if (notice.will_retry) {
          await this.logger.log("warn", "[agent] model_stream.retry", {
            session_id: this.session_id,
            retry_count: notice.attempt,
            error_code: notice.code,
            error: notice.message,
            provider_request_id: notice.provider_request_id ?? null,
          });
        }
      },
      execute_attempt: async () => {
        await turn_context.output.assistant?.begin_step();
        try {
          return await run_model_step({
            model: input.step_input.model,
            system: input.step_input.system,
            messages: input.step_input.messages,
            tools: input.tools_override ?? input.step_input.tools,
            abort_signal: turn_context.lifecycle.abort_signal,
            ...(turn_context.output.assistant
              ? { assistant_output: turn_context.output.assistant }
              : {}),
            approve_tool: async (call, tool) => await resolve_tool_approval({
              call,
              tool,
              turn_context,
            }),
          });
        } catch (error) {
          await turn_context.output.assistant?.abort_step();
          throw error;
        }
      },
    });

    let step_assistant_parts = result.assistant_parts;
    await input.on_step_finish(result.step_result);
    if (turn_context.output.assistant) {
      await turn_context.output.assistant.finish_step(step_assistant_parts);
    }
    const action_assistant_parts = turn_context.output.take_assistant_parts();
    if (action_assistant_parts.length > 0) {
      const persisted_parts = turn_context.output.assistant
        ? await turn_context.output.assistant.append_result_parts(
            action_assistant_parts,
          )
        : action_assistant_parts.map((part, index) =>
            create_session_agent_content_part(
              part,
              `${part.type}:${generate_id()}`,
              index + 1,
            )
          );
      step_assistant_parts = merge_assistant_parts(
        step_assistant_parts,
        persisted_parts,
      );
    }
    return {
      step_result: result.step_result,
      step_assistant_parts,
    };
  }

  /**
   * 达到工具循环上限后，要求模型在禁用工具的前提下给出收尾结论。
   *
   * 关键点（中文）
   * - 收尾提示先持久化为 internal canonical User Message，不绕过 Composer 注入运行时输入。
   * - 收尾 Step 仍走统一模型请求重试与上下文压缩恢复，真实 Provider 错误不会被吞掉。
   * - 只执行一次；收尾仍无正文时由调用方按明确失败收口。
   */
  private async execute_max_steps_finalization(input: {
    /** 当前显式运行上下文。 */
    turn_context: SessionTurnContext;
    /** 按当前 canonical history 重新装配收尾 Step 输入。 */
    resolve_step_input: () => Promise<SessionStepExecutionInput>;
    /** 合并收尾 Step 的计数与诊断日志。 */
    on_step_finish: (step_result: ModelStepResult) => Promise<void>;
  }): Promise<{
    /** 收尾 Step 产生的 canonical Assistant Parts。 */
    assistant_parts: SessionAgentMessagePart[];
    /** 收尾是否真正产出了用户可见正文。 */
    produced_text: boolean;
  }> {
    await input.turn_context.input.append_internal([{
      type: "text",
      text: build_max_steps_finalization_nudge(MAX_TOOL_LOOP_STEPS),
    }]);
    await input.turn_context.input.checkpoint();
    const step = await this.execute_provider_step({
      turn_context: input.turn_context,
      step_input: await input.resolve_step_input(),
      tools_override: {},
      on_step_finish: input.on_step_finish,
    });
    const produced_text =
      extract_assistant_text(step.step_assistant_parts).length > 0;
    await this.logger.log(
      produced_text ? "info" : "warn",
      "[agent] loop.max_steps_finalized",
      {
        session_id: this.session_id,
        maxSteps: MAX_TOOL_LOOP_STEPS,
        producedText: produced_text,
      },
    );
    return {
      assistant_parts: step.step_assistant_parts,
      produced_text,
    };
  }
}

/** 在工具执行前接入 Session canonical Interaction 生命周期。 */
async function resolve_tool_approval(input: {
  call: ModelStepToolCall;
  tool: Tool;
  turn_context: SessionTurnContext;
}): Promise<boolean> {
  const needs_approval = input.tool.needs_approval;
  const required = typeof needs_approval === "function"
      ? await needs_approval(input.call.input as never, {
        tool_call_id: input.call.tool_call_id,
        messages: [],
      })
    : needs_approval === true;
  if (!required) return true;
  const interactions = input.turn_context.interactions;
  if (!interactions) {
    throw new Error("Tool approval requires a Session Interaction port");
  }
  const approval_id = `approval:${input.call.tool_call_id}`;
  const handle = await interactions.request({
    interaction_id: `interaction:tool-approval:${approval_id}`,
    turn_id: input.turn_context.session.turn_id,
    type: "approval",
    source: {
      type: "tool",
      tool_call_id: input.call.tool_call_id,
      tool_name: input.call.tool_name,
    },
    payload: {
      operation: "tool",
      validated_input: to_session_json_value(input.call.input),
      ...(input.tool.description ? { tool_description: input.tool.description } : {}),
    },
    response_schema: SESSION_APPROVAL_RESPONSE_SCHEMA,
    created_at: Date.now(),
  });
  const result = await handle.result;
  const payload = result.status === "resolved" && result.response.type === "approval"
    ? result.response.payload as { decision?: unknown }
    : undefined;
  return result.status === "resolved" &&
    result.response.type === "approval" &&
    result.response.outcome === "resolved" &&
    payload?.decision === "approved";
}

/** 构造成功执行但缺少最终内容时使用的 canonical Assistant Parts。 */
function build_fallback_assistant_parts(
  text: string,
): SessionAgentMessagePart[] {
  return [{
    part_id: "fallback-text:1",
    sequence: 1,
    type: "text",
    text,
    state: "done",
  }];
}
