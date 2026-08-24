/**
 * ask_question 可选 Tool。
 *
 * 该 Tool 只负责把模型的结构化 Tool Call 映射到当前 Session 的 Question
 * Interaction。Session 是交互状态和生命周期的唯一拥有者；Tool 等待 Session 返回终态，
 * 再把用户答案作为 Tool Result 交回同一 Turn 的后续模型 Step。
 */

import { tool, type ToolExecutionOptions } from "ai";
import { ask_questions_input_schema } from "./AskQuestionsToolSchemas.js";
import type {
  AskQuestionsToolInput,
  AskQuestionsToolOutput,
} from "@/types/tools/ask/AskQuestionsTool.js";
import type { SessionToolExecutionContext } from "@/types/executor/SessionToolExecutionContext.js";
import { generate_id } from "@/utils/Id.js";
import type { ActionResult } from "@/types/action/ActionResult.js";
import type { JsonValue } from "@/types/common/Json.js";
import type { SessionInteractionAnswer } from "@/types/session/SessionInteraction.js";

/**
 * 由调用方显式注册、按当前 Session Turn 上下文执行的提问 Tool。
 *
 * @example
 * ```ts
 * new Agent({
 *   tools: {
 *     ask_question: AskQuestionsTool,
 *   },
 * });
 * ```
 */
export const AskQuestionsTool = tool({
  description:
    "Ask the user one or more questions when missing information would materially change the outcome. The call waits for every answer, then returns them so you can continue the same task. Do not use it for information that can be inferred safely. For single_select and multi_select questions, every option MUST contain both a machine-readable value and a user-visible label; never omit value or use label as value. Example: { value: 'cn', label: '中国' }.",
  inputSchema: ask_questions_input_schema,
  execute: async (
    input: AskQuestionsToolInput,
    execution_options: ToolExecutionOptions,
  ): Promise<ActionResult<AskQuestionsToolOutput>> => {
    const execution_context = execution_options.experimental_context as
      | Partial<SessionToolExecutionContext>
      | undefined;
    const action_execution = execution_context?.action_execution_context;
    const interaction_port = action_execution?.session.interactions;
    const turn_id = String(action_execution?.session.turn_id || "").trim();
    const tool_call_id = String(action_execution?.call_id || "").trim();
    if (!interaction_port || !turn_id || !tool_call_id) {
      throw new Error(
        "ask_question requires an active Session tool execution context",
      );
    }

    const handle = await interaction_port.request({
      interaction_id: `interaction:${generate_id()}`,
      turn_id,
      type: "question",
      source: {
        type: "tool",
        tool_call_id,
        tool_name: "ask_question",
      },
      title: input.title,
      payload: {
        questions: input.questions.map((question) => ({
          question_id: `question:${generate_id()}`,
          prompt: question.question,
          response_type: question.type,
          ...(question.options ? { options: question.options } : {}),
        })),
      } as unknown as JsonValue,
      created_at: Date.now(),
    });
    const result = await handle.result;
    if (result.status === "cancelled") {
      throw new Error(`ask_question was cancelled: ${result.reason}`);
    }
    if (result.status === "expired") {
      throw new Error("ask_question expired before the user responded");
    }
    if (
      result.status !== "resolved" ||
      result.response.type !== "question" ||
      result.response.outcome !== "resolved"
    ) {
      throw new Error(
        "ask_question received an incompatible Interaction response",
      );
    }
    return {
      output: {
        status: "resolved",
        answers: (result.response.payload as unknown as { answers: SessionInteractionAnswer[] }).answers,
      },
      messages: [],
    };
  },
});
