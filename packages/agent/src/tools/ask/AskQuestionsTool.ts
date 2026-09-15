/**
 * ask_question 可选 Tool。
 *
 * 该 Tool 只负责把模型的结构化 Tool Call 映射到当前 Session 的 Question
 * Interaction。Session 是交互状态和生命周期的唯一拥有者；Tool 等待 Session 返回终态，
 * 再把用户答案作为 Tool Result 交回同一 Turn 的后续模型 Step。
 *
 * Interaction 的 `payload` 由生产者解释，所以问题与回答的校验都在这里：入参先过
 * Schema，回答再过 {@link resolve_ask_question_answers}，核心不参与业务字段。
 */

import {
  define_runtime_tool,
  type RuntimeToolExecutionOptions as ToolExecutionOptions,
} from "@downcity/type";
import { ask_questions_input_schema } from "./AskQuestionsToolSchemas.js";
import {
  read_ask_question_note,
  resolve_ask_question_answers,
} from "./AskQuestionAnswers.js";
import type {
  AskQuestionsToolInput,
  AskQuestionsToolOutput,
} from "@/types/tools/ask/AskQuestionsTool.js";
import type { SessionToolExecutionContext } from "@/types/executor/SessionToolExecutionContext.js";
import { generate_id } from "@/utils/Id.js";
import type { ActionResult } from "@/types/action/ActionResult.js";
import type { JsonValue } from "@downcity/type";
import type { SessionInteractionQuestion } from "@downcity/type";

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
export const AskQuestionsTool = define_runtime_tool<AskQuestionsToolInput, ActionResult<AskQuestionsToolOutput>>({
  description:
    "Ask the user one or more questions when missing information would materially change the outcome. The call waits for every answer, then returns them so you can continue the same task. Do not use it for information that can be inferred safely. For single_select and multi_select questions, every option MUST contain both a machine-readable value and a user-visible label; never omit value or use label as value. Example: { value: 'cn', label: '中国' }.",
  input_schema: ask_questions_input_schema,
  execute: async (
    input: AskQuestionsToolInput,
    execution_options: ToolExecutionOptions,
  ): Promise<ActionResult<AskQuestionsToolOutput>> => {
    const execution_context = execution_options.context as
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

    // 入参先过 Schema：模型漏写 type 这类缺陷在发起交互之前就暴露，不会落成待响应卡片。
    const parsed = ask_questions_input_schema.parse(input);
    // 问题只在模型输入上补一个 Session 生成的 question_id，其余字段原样落库。
    const questions: SessionInteractionQuestion[] = parsed.questions.map(
      (question) => ({ ...question, question_id: `question:${generate_id()}` }),
    );

    const handle = await interaction_port.request({
      interaction_id: `interaction:${generate_id()}`,
      turn_id,
      type: "question",
      source: {
        type: "tool",
        tool_call_id,
        tool_name: "ask_question",
      },
      title: parsed.title,
      payload: { questions } as unknown as JsonValue,
      created_at: Date.now(),
    });
    const result = await handle.result;
    if (result.status === "cancelled") {
      throw new Error(`ask_question was cancelled: ${result.reason}`);
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
    const answers = resolve_ask_question_answers(questions, result.response.payload);
    const note = read_ask_question_note(result.response.payload);
    return {
      output: {
        status: "resolved",
        answers,
        ...(note ? { note } : {}),
      },
      messages: [],
    };
  },
});
