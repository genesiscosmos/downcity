/**
 * CoreEngineRunner：模型与 tool-loop 主循环执行器。
 *
 * 关键点（中文）
 * - 只负责单次已装配输入的执行，不负责外层运行上下文、重试与历史准备。
 * - 把 step 循环、续写恢复、最终 assistant 汇总等细节从 Executor 中剥离。
 * - 保持失败返回结构稳定，避免对外 Session 行为变化。
 */

import {
  streamText,
  type FileUIPart,
  type LanguageModel,
  type ModelMessage,
  type StepResult,
  type Tool,
  type ToolApprovalRequestOutput,
  type ToolApprovalResponse,
  type UIMessage,
} from "ai";
import { log_assistant_message_now } from "@executor/messages/SessionMessageLog.js";
import { pick_last_successful_chat_send_text } from "@executor/messages/UserVisibleText.js";
import {
  MAX_INCOMPLETE_RESPONSE_RECOVERIES,
  MAX_TOOL_LOOP_STEPS,
  build_incomplete_response_recovery_nudge,
  detect_incomplete_response,
  merge_assistant_ui_messages,
  summarize_step_for_debug,
  summarize_ui_message_for_debug,
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
import { collect_final_assistant_message_from_ui_stream } from "@executor/core-engine/CoreEngineUiStreamCollector.js";
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
import type {
  SessionRecordV1,
  SessionMessageRecordV1,
} from "@/executor/types/SessionRecords.js";

const TURN_STOPPED_MESSAGE = "Turn stopped";

/** Provider context-length error 在当前 step 内最多压缩重试三次。 */
const MAX_CONTEXT_ERROR_COMPACTION_RETRIES = 3;

/**
 * 生成 file part 去重 key。
 */
function build_file_part_key(part: FileUIPart): string {
  return [
    String(part.type || ""),
    String(part.mediaType || ""),
    String(part.filename || ""),
    String(part.url || ""),
  ].join("\n");
}

/**
 * 把 tool/plugin 运行期产生的 file parts 并入最终 assistant UIMessage。
 */
function merge_assistant_parts(
  message: SessionMessageRecordV1,
  parts: UIMessage["parts"],
): SessionMessageRecordV1 {
  if (!Array.isArray(parts) || parts.length === 0) return message;
  const current_parts = Array.isArray(message.parts) ? message.parts : [];
  const seen = new Set<string>();
  for (const part of current_parts) {
    const candidate = part as UIMessage["parts"][number];
    if (candidate?.type !== "file") continue;
    seen.add(build_file_part_key(candidate as FileUIPart));
  }
  const next_parts = parts.filter((part) => {
    if (part.type !== "file") return true;
    const key = build_file_part_key(part as FileUIPart);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (next_parts.length === 0) return message;
  return {
    ...message,
    parts: [...current_parts, ...next_parts],
  };
}

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
  model: LanguageModel;

  /**
   * 当前显式运行上下文。
   */
  turn_context: SessionTurnContext;

  /**
   * 在统一输入队列提交后解析当前 Session step 的 effective 配置。
   */
  resolve_step_inputs: () => Promise<{
    /** 当前 Session step 使用的模型。 */
    model: LanguageModel;
    /** 当前 Session step 使用的 system messages。 */
    system: SessionStepExecutionInput["system"];
    /** 当前 Session step 使用的工具集合。 */
    tools: SessionStepExecutionInput["tools"];
    /** 当前 Session step 模型支持的总上下文窗口长度。 */
    context_window?: number;
  }>;

  /** 持久化 compact 后重新读取 Composer 生成的 canonical history。 */
  reload_history: () => Promise<SessionRecordV1[]>;
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
      let final_assistant_ui_message: SessionMessageRecordV1 | null = null;
      let ui_stream_continuation_message: SessionMessageRecordV1 | null = null;
    let compact_required = false;

    try {
      const message_state = await CoreEngineMessageState.create({
        messages: input.execute_input.messages,
        tools,
        project_root: input.turn_context.session.project_root,
      });
      let persisted_compaction_summary_id = resolve_compaction_summary_id(
        input.execute_input.messages,
      );

      const append_merged_user_messages = (messages: SessionRecordV1[]) =>
        message_state.appendMergedUserMessages(messages);

      let step_count = 0;
      let total_tool_call_count = 0;
      let total_tool_result_count = 0;
      const on_step_finish = async (
        step_result: StepResult<Record<string, Tool>>,
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
          const canonical_records = await input.reload_history();
          await message_state.replace_session_messages(canonical_records, tools);
          persisted_compaction_summary_id = resolve_compaction_summary_id(
            canonical_records,
          );
          compact_validation_pending = Boolean(
            persisted_compaction_summary_id &&
              persisted_compaction_summary_id !==
                this.validated_compaction_summary_id,
          );
          await this.logger.log("info", "[agent] context.history_reloaded", {
            session_id: session_id,
            recordCount: canonical_records.length,
            compactionSummaryId: persisted_compaction_summary_id || undefined,
          });
        }
        if (compact_pending) {
          const previous_message_count = message_state.modelMessages.length;
          message_state.replace_model_messages(
            deep_compact_model_messages(
              message_state.modelMessages,
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
            nextMessageCount: message_state.modelMessages.length,
          });
        }

        last_observed_stream_error = undefined;
        let step_assistant_ui_message: SessionMessageRecordV1;
        let executed_steps: StepResult<Record<string, Tool>>[];
        const observed_steps: StepResult<Record<string, Tool>>[] = [];
        let canonical_step_started = false;
        let canonical_step_finished = false;
        try {
          if (input.turn_context.output.assistant) {
            await input.turn_context.output.assistant.begin_step();
            canonical_step_started = true;
          }
          const result = streamText({
            model: step_inputs.model,
            system,
            onStepFinish: async (step_result) => {
              observed_steps.push(step_result);
              await on_step_finish(step_result);
            },
            messages: message_state.modelMessages,
            tools,
            abortSignal: input.turn_context.lifecycle.abort_signal,
            onError: async ({ error }) => {
              last_observed_stream_error = error;
              await this.logger.log("error", "[agent] stream.error", {
                session_id: session_id,
                ...summarize_stream_error(error),
              });
            },
          });

          step_assistant_ui_message =
            await collect_final_assistant_message_from_ui_stream({
              result,
              session_id: session_id,
              original_messages: ui_stream_continuation_message
                ? [ui_stream_continuation_message]
                : undefined,
              logger: this.logger,
              buildFallbackAssistantMessage: (text) =>
                build_fallback_assistant_message(session_id, text),
              on_ui_message_chunk_callback: input.turn_context.output.assistant
                ? async (chunk) => {
                    await input.turn_context.output.assistant?.write_chunk(chunk);
                  }
                : undefined,
              abort_signal: input.turn_context.lifecycle.abort_signal,
            });

          if (input.turn_context.output.assistant) {
            await input.turn_context.output.assistant.finish_step(
              step_assistant_ui_message,
            );
          }
          const action_assistant_parts =
            input.turn_context.output.take_assistant_parts();
          if (action_assistant_parts.length > 0) {
            await input.turn_context.output.assistant?.append_parts(
              action_assistant_parts,
            );
            step_assistant_ui_message = merge_assistant_parts(
              step_assistant_ui_message,
              action_assistant_parts,
            );
          }
          canonical_step_finished = true;

          final_assistant_ui_message = merge_assistant_ui_messages(
            final_assistant_ui_message,
            step_assistant_ui_message,
          );

          // 关键点（中文）：先保存本 step 已收敛的 assistant 消息，再等待 Provider 终态。
          // stop / error 时已经生成的部分内容仍会保留，但 `result.steps` 必须作为错误传播边界。
          message_state.appendRuntimeSessionMessage(step_assistant_ui_message);
          executed_steps = await result.steps;
          ui_stream_continuation_message = null;
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
            const previous_message_count = message_state.modelMessages.length;
            message_state.replace_model_messages(
              deep_compact_model_messages(
                message_state.modelMessages,
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
              nextMessageCount: message_state.modelMessages.length,
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
          assistant_message: step_assistant_ui_message,
        });
        const loop_decision = evaluate_core_engine_loop_decision({
          hasIncompleteResponse: incomplete_response !== null,
          incompleteRecoveryCount: incomplete_response_recovery_count,
          maxIncompleteRecoveries: MAX_INCOMPLETE_RESPONSE_RECOVERIES,
          toolCallCount: last_step.toolCalls.length,
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
          toolCallCount: last_step.toolCalls.length,
          toolResultCount: last_step.toolResults.length,
          finishReason: last_step.finishReason,
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
          await message_state.appendUserTextMessage(recovery_message);
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
        const approval_responses = await resolve_tool_approval_responses({
          step: last_step,
          tools,
          turn_context: input.turn_context,
        });
        message_state.appendModelMessages(response_messages);
        if (approval_responses.length > 0) {
          message_state.appendModelMessages([
            { role: "tool", content: approval_responses } as ModelMessage,
          ]);
          // 原生审批的下一次 streamText 会先恢复上一条 Tool Part，再继续模型输出。
          ui_stream_continuation_message = final_assistant_ui_message;
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

      if (step_count >= MAX_TOOL_LOOP_STEPS) {
        await this.logger.log("warn", "[agent] loop.max_steps_reached", {
          session_id: session_id,
          stepCount: step_count,
          totalToolCallCount: total_tool_call_count,
          totalToolResultCount: total_tool_result_count,
        });
      }

      const final_message = final_assistant_ui_message ||
        build_fallback_assistant_message(session_id, "Execution completed");

      await this.logger.log("info", "[agent] final.message", {
        session_id: session_id,
        ...summarize_ui_message_for_debug(final_message),
      });
      await log_assistant_message_now(this.logger, final_message);

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
        text: pick_last_successful_chat_send_text(final_message),
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
        const stopped_message = final_assistant_ui_message;
        return {
          success: false,
          text: stopped_message
            ? pick_last_successful_chat_send_text(stopped_message)
            : "",
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
        text: final_assistant_ui_message
          ? pick_last_successful_chat_send_text(final_assistant_ui_message)
          : "",
        error: error_text,
        ...(compact_required ? { compact_required: true } : {}),
        deferred_persisted_user_messages: [
          ...input.turn_context.input.deferred_user_messages(),
        ],
      };
    }
  }
}

/** 把 AI SDK Tool Approval 接入 Session 的 canonical Interaction 生命周期。 */
async function resolve_tool_approval_responses(input: {
  step: StepResult<Record<string, Tool>>;
  tools: Record<string, Tool>;
  turn_context: SessionTurnContext;
}): Promise<ToolApprovalResponse[]> {
  const requests = input.step.content.filter(
    (part): part is ToolApprovalRequestOutput<Record<string, Tool>> =>
      part.type === "tool-approval-request",
  );
  if (requests.length === 0) return [];
  const interactions = input.turn_context.interactions;
  if (!interactions) {
    throw new Error("Tool approval requires a Session Interaction port");
  }

  return await Promise.all(
    requests.map(async (request) => {
      const tool_name = request.toolCall.toolName;
      const tool_definition = input.tools[tool_name];
      const model_explanation = String(input.step.text || "").trim();
      const handle = await interactions.request({
        interaction_id: `interaction:tool-approval:${request.approvalId}`,
        turn_id: input.turn_context.session.turn_id,
        kind: "approval",
        operation: "tool",
        source: {
          type: "tool",
          tool_call_id: request.toolCall.toolCallId,
          tool_name,
        },
        validated_input: to_session_json_value(request.toolCall.input),
        ...(tool_definition?.description
          ? { tool_description: tool_definition.description }
          : {}),
        ...(model_explanation ? { model_explanation } : {}),
        created_at: Date.now(),
      });
      const result = await handle.result;
      const approved = result.status === "resolved" &&
        result.response.kind === "approval" &&
        result.response.decision === "approved";
      return {
        type: "tool-approval-response",
        approvalId: request.approvalId,
        approved,
      };
    }),
  );
}

/** 构造仅在当前 Turn 内使用的内部 User Message。 */
function build_internal_user_message(input: {
  session_id: string;
  text: string;
  extra: JsonObject;
}): SessionRecordV1 {
  return {
    id: `u:${input.session_id}:${Date.now()}`,
    role: "user",
    metadata: {
      v: 1,
      ts: Date.now(),
      session_id: input.session_id,
      source: "ingress",
      kind: "normal",
      extra: input.extra,
    },
    parts: [{ type: "text", text: input.text }],
  };
}

/** 构造成功执行但缺少最终消息时使用的临时 Assistant Message。 */
function build_fallback_assistant_message(
  session_id: string,
  text: string,
): SessionMessageRecordV1 {
  return {
    id: `a:${session_id}:${Date.now()}`,
    role: "assistant",
    metadata: {
      v: 1,
      ts: Date.now(),
      session_id: session_id,
      source: "egress",
      kind: "normal",
    },
    parts: [{ type: "text", text }],
  };
}

/** 读取当前模型上下文中最新的持久化 compact Summary 标识。 */
function resolve_compaction_summary_id(messages: SessionRecordV1[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!("role" in message) || message.role !== "assistant") continue;
    if (
      message.metadata?.source === "compact" &&
      message.metadata.kind === "summary"
    ) {
      return String(message.id || "").trim();
    }
  }
  return "";
}
