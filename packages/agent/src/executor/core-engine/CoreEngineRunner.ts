/**
 * CoreEngineRunner：模型与 tool-loop 主循环执行器。
 *
 * 关键点（中文）
 * - 只负责单次已装配输入的执行，不负责外层运行上下文、重试与历史准备。
 * - 把 step 循环、续写恢复、最终 assistant 汇总等细节从 Executor 中剥离。
 * - 保持失败返回结构稳定，避免对外 Session 行为变化。
 */

import type { ModelClient, ModelMessage } from "@downcity/type";
import type { RuntimeTool as Tool } from "@downcity/type";
import { log_assistant_message_now } from "@executor/messages/SessionMessageLog.js";
import {
  MAX_INCOMPLETE_RESPONSE_RECOVERIES,
  MAX_TOOL_LOOP_STEPS,
  build_incomplete_response_recovery_nudge,
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
  summarize_stream_error,
} from "@executor/core-engine/CoreEngineError.js";
import {
  run_model_step,
  type ModelStepResult,
  type ModelStepToolCall,
} from "@executor/model/ModelStepRunner.js";
import { CoreEngineMessageState } from "@executor/core-engine/CoreEngineMessageState.js";
import {
  deep_compact_model_messages,
  resolve_model_usage_ratio,
  should_compact_after_usage,
} from "@executor/core-engine/CoreEngineContextCompaction.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { JsonObject } from "@/types/common/Json.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import { to_session_json_value } from "@/session/messages/SessionJsonValue.js";
import type {
  SessionStepExecutionInput,
  SessionTurnExecutionResult,
} from "@/types/session/SessionExecution.js";
import type { SessionAssistantResultPart } from "@/types/session/SessionContent.js";
import type {
  SessionAssistantMessagePart,
  SessionUserMessage,
} from "@/types/session/SessionMessage.js";

const TURN_STOPPED_MESSAGE = "Turn stopped";

/** Provider context-length error 在当前 step 内最多压缩重试三次。 */
const MAX_CONTEXT_ERROR_COMPACTION_RETRIES = 3;

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
   * 已装配好的执行输入。
   */
  execute_input: SessionStepExecutionInput;

  /**
   * 当前轮模型实例。
   */
  model: ModelClient;

  /**
   * 当前显式运行上下文。
   */
  turn_context: SessionTurnContext;

  /**
   * 在统一输入队列提交后解析当前 Session step 的 effective 配置。
   */
  resolve_step_inputs: () => Promise<{
    /** 当前 Session step 使用的模型。 */
    model: ModelClient;
    /** 当前 Session step 使用的 system messages。 */
    system: SessionStepExecutionInput["system"];
    /** 当前 Session step 使用的工具集合。 */
    tools: SessionStepExecutionInput["tools"];
    /** 当前 Session step 模型支持的总上下文窗口长度。 */
    context_window?: number;
  }>;

  /** 持久化 compact 后重新读取 Composer 生成的模型历史与 Summary 身份。 */
  reload_history: () => Promise<{
    /** Composer 重新生成的标准模型消息。 */
    messages: ModelMessage[];
    /** 当前模型历史包含的最新持久化 Summary 标识。 */
    summary_id?: string;
  }>;
}

/**
 * 模型与 tool-loop 主循环执行器。
 */
export class CoreEngineRunner {
  private readonly session_id: string;
  private readonly logger: Logger;
  private readonly should_compact_on_error: CoreEngineRunnerOptions["should_compact_on_error"];

  /** 最近一次已经通过真实 usage 验收的持久化 Summary 标识。 */
  private validated_compaction_summary_id = "";

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
    let system = Array.isArray(input.execute_input.system)
      ? input.execute_input.system
      : [];
    let tools = input.execute_input.tools;
    let last_observed_stream_error: unknown = undefined;
    let final_assistant_parts: SessionAssistantMessagePart[] = [];
    let compact_required = false;

    try {
      const message_state = await CoreEngineMessageState.create({
        messages: input.execute_input.messages,
        project_root: input.turn_context.session.project_root,
      });
      let persisted_compaction_summary_id =
        input.execute_input.history_summary_id || "";

      const append_merged_user_messages = (messages: SessionUserMessage[]) =>
        message_state.append_merged_user_messages(messages);

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
      let context_error_compaction_retries = 0;
      let compact_pending = false;
      let compact_validation_pending = Boolean(
        persisted_compaction_summary_id &&
          persisted_compaction_summary_id !==
            this.validated_compaction_summary_id,
      );
      let compact_depth = 0;

      while (step_count < MAX_TOOL_LOOP_STEPS) {
        // 关键点（中文）：steer 与 command 在同一个 Session step 检查点执行。
        // 当前流与 tool callback 保持原执行视图，下一 step 再统一读取 effective 配置。
        await append_merged_user_messages(
          await input.turn_context.input.checkpoint(),
        );
        const step_inputs = await input.resolve_step_inputs();
        system = Array.isArray(step_inputs.system) ? step_inputs.system : [];
        tools = step_inputs.tools;
        if (input.turn_context.input.consume_history_reload()) {
          const reloaded_history = await input.reload_history();
          message_state.replace_model_history(reloaded_history.messages);
          persisted_compaction_summary_id = reloaded_history.summary_id || "";
          compact_validation_pending = Boolean(
            persisted_compaction_summary_id &&
              persisted_compaction_summary_id !==
                this.validated_compaction_summary_id,
          );
          await this.logger.log("info", "[agent] context.history_reloaded", {
            session_id: session_id,
            recordCount: reloaded_history.messages.length,
            compactionSummaryId: persisted_compaction_summary_id || undefined,
          });
        }
        if (compact_pending) {
          const previous_message_count = message_state.model_messages.length;
          message_state.replace_model_messages(
            deep_compact_model_messages(
              message_state.model_messages,
              compact_depth,
            ),
          );
          compact_depth += 1;
          compact_pending = false;
          compact_validation_pending = true;
          compact_required = true;
          await this.logger.log("info", "[agent] context.compacted", {
            session_id: session_id,
            reason: "usage_threshold",
            compactDepth: compact_depth,
            previousMessageCount: previous_message_count,
            nextMessageCount: message_state.model_messages.length,
          });
        }

        last_observed_stream_error = undefined;
        let step_assistant_parts: SessionAssistantMessagePart[];
        let executed_steps: ModelStepResult[];
        let canonical_step_started = false;
        let canonical_step_finished = false;
        try {
          if (input.turn_context.output.assistant) {
            await input.turn_context.output.assistant.begin_step();
            canonical_step_started = true;
          }
          const result = await run_model_step({
            model: step_inputs.model,
            system,
            messages: message_state.model_messages,
            tools,
            abort_signal: input.turn_context.lifecycle.abort_signal,
            ...(input.turn_context.output.assistant
              ? { assistant_output: input.turn_context.output.assistant }
              : {}),
            approve_tool: async (call, tool) => await resolve_tool_approval({
              call,
              tool,
              turn_context: input.turn_context,
            }),
          });
          step_assistant_parts = result.assistant_parts;
          await on_step_finish(result.step_result);

          if (input.turn_context.output.assistant) {
            await input.turn_context.output.assistant.finish_step(
              step_assistant_parts,
            );
          }
          const action_assistant_parts =
            input.turn_context.output.take_assistant_parts();
          if (action_assistant_parts.length > 0) {
            await input.turn_context.output.assistant?.append_result_parts(
              action_assistant_parts,
            );
            step_assistant_parts = merge_assistant_parts(
              step_assistant_parts,
              action_parts_to_canonical(action_assistant_parts),
            );
          }
          canonical_step_finished = true;

          final_assistant_parts = merge_assistant_parts(
            final_assistant_parts,
            step_assistant_parts,
          );
          executed_steps = [result.step_result];
        } catch (error) {
          if (
            canonical_step_started &&
            !canonical_step_finished &&
            input.turn_context.output.assistant
          ) {
            await input.turn_context.output.assistant.abort_step();
          }
          const compact_error = this.should_compact_on_error(error)
            ? error
            : last_observed_stream_error;
          if (
            this.should_compact_on_error(compact_error) &&
            context_error_compaction_retries <
              MAX_CONTEXT_ERROR_COMPACTION_RETRIES
          ) {
            context_error_compaction_retries += 1;
            const previous_message_count = message_state.model_messages.length;
            message_state.replace_model_messages(
              deep_compact_model_messages(
                message_state.model_messages,
                compact_depth,
              ),
            );
            compact_depth += 1;
            compact_pending = false;
            compact_validation_pending = true;
            compact_required = true;
            await this.logger.log("warn", "[agent] context.compacted", {
              session_id: session_id,
              reason: "provider_context_error",
              retryCount: context_error_compaction_retries,
              compactDepth: compact_depth,
              previousMessageCount: previous_message_count,
              nextMessageCount: message_state.model_messages.length,
              ...summarize_stream_error(compact_error),
            });
            continue;
          }
          throw error;
        }

        context_error_compaction_retries = 0;
        const last_step = executed_steps[executed_steps.length - 1];
        if (!last_step) break;

        const usage_ratio = resolve_model_usage_ratio(
          last_step.usage,
          step_inputs.context_window,
        );
        if (usage_ratio !== null) {
          const validating_compaction = compact_validation_pending;
          compact_pending = should_compact_after_usage(
            usage_ratio,
            validating_compaction,
          );
          compact_validation_pending = false;
          if (validating_compaction && persisted_compaction_summary_id) {
            this.validated_compaction_summary_id =
              persisted_compaction_summary_id;
          }
          if (compact_pending) compact_required = true;
          await this.logger.log("info", "[agent] context.usage", {
            session_id: session_id,
            step_index: step_count,
            usageRatio: usage_ratio,
            contextWindow: step_inputs.context_window,
            validatingCompaction: validating_compaction,
            compactPending: compact_pending,
          });
        }

        const incomplete_response = detect_incomplete_response({
          step_result: last_step,
          assistant_parts: step_assistant_parts,
        });
        const loop_decision = evaluate_core_engine_loop_decision({
          hasIncompleteResponse: incomplete_response !== null,
          incompleteRecoveryCount: incomplete_response_recovery_count,
          maxIncompleteRecoveries: MAX_INCOMPLETE_RESPONSE_RECOVERIES,
          toolCallCount: last_step.tool_calls.length,
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
          toolCallCount: last_step.tool_calls.length,
          toolResultCount: last_step.tool_results.length,
          finishReason: last_step.finish_reason,
          textPreview: to_inline_preview(last_step.text),
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
          const recovery_message = build_internal_user_message({
            session_id,
            text: build_incomplete_response_recovery_nudge(
              incomplete_response_recovery_count,
            ),
            extra: {
              internal: "agent_incomplete_response_recover",
              reason: incomplete_response.reason,
              step_index: step_count,
            },
          });
          await message_state.append_user_message(recovery_message);
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

        const response_messages = Array.isArray(last_step.response?.messages)
          ? last_step.response.messages
          : [];
        message_state.append_model_messages(response_messages);

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

      if (step_count >= MAX_TOOL_LOOP_STEPS) {
        await this.logger.log("warn", "[agent] loop.max_steps_reached", {
          session_id: session_id,
          stepCount: step_count,
          totalToolCallCount: total_tool_call_count,
          totalToolResultCount: total_tool_result_count,
        });
      }

      const final_parts = final_assistant_parts.length > 0
        ? final_assistant_parts
        : build_fallback_assistant_parts("Execution completed");

      await this.logger.log("info", "[agent] final.message", {
        session_id: session_id,
        ...summarize_assistant_parts_for_debug(final_parts),
      });
      await log_assistant_message_now(this.logger, final_parts);

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
        deferred_persisted_user_messages: [
          ...input.turn_context.input.deferred_user_messages(),
        ],
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
          deferred_persisted_user_messages: [
            ...input.turn_context.input.deferred_user_messages(),
          ],
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
        deferred_persisted_user_messages: [
          ...input.turn_context.input.deferred_user_messages(),
        ],
      };
    }
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

/** 构造仅在当前 Turn 内使用的内部 User Message。 */
function build_internal_user_message(input: {
  session_id: string;
  text: string;
  extra: JsonObject;
}): SessionUserMessage {
  void input.extra;
  const now = Date.now();
  return {
    message_id: `runtime-user:${input.session_id}:${now}`,
    session_id: input.session_id,
    sequence: 0,
    revision: 1,
    visibility: "internal",
    created_at: now,
    updated_at: now,
    type: "user",
    input_type: "steer",
    parts: [{
      part_id: "runtime-text:1",
      type: "text",
      text: input.text,
      state: "done",
    }],
  };
}

/** 把 Action 结果内容转换为当前 Turn 使用的 canonical Assistant Parts。 */
function action_parts_to_canonical(
  parts: readonly SessionAssistantResultPart[],
): SessionAssistantMessagePart[] {
  return parts.map((part, index) => {
    const sequence = index + 1;
    if (part.type === "text") {
      return {
        part_id: `action-text:${sequence}`,
        sequence,
        type: "text",
        text: part.text,
        state: "done",
      };
    }
    if (part.type === "file") {
      return {
        part_id: `action-file:${sequence}`,
        sequence,
        type: "file",
        media_type: part.media_type,
        url: part.url,
        ...(part.filename ? { filename: part.filename } : {}),
      };
    }
    return {
      part_id: `action-data:${sequence}`,
      sequence,
      type: "data",
      data_type: part.data_type,
      data: part.data,
      ...(part.data_id ? { data_id: part.data_id } : {}),
    };
  });
}

/** 构造成功执行但缺少最终内容时使用的 canonical Assistant Parts。 */
function build_fallback_assistant_parts(
  text: string,
): SessionAssistantMessagePart[] {
  return [{
    part_id: "fallback-text:1",
    sequence: 1,
    type: "text",
    text,
    state: "done",
  }];
}
