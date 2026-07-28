/**
 * Session ask_question 内置 Tool。
 *
 * 该 Tool 只负责把模型的结构化 Tool Call 映射到当前 Session 的 Question
 * Interaction。Session 是交互状态和生命周期的唯一拥有者；Tool 等待 Session 返回终态，
 * 再把用户答案作为 Tool Result 交回同一 Turn 的后续模型 Step。
 */

import { tool, type ToolExecutionOptions } from "ai";
import { ask_question_input_schema } from "@/executor/tools/interaction/AskQuestionToolSchemas.js";
import type {
  AskQuestionToolInput,
  AskQuestionToolOutput,
} from "@/types/executor/AskQuestionTool.js";
import type { SessionToolExecutionContext } from "@/types/executor/SessionToolExecutionContext.js";
import { generate_id } from "@/utils/Id.js";

/** 创建由所有本地 Session 共享定义、按当前 Turn 上下文执行的 ask_question Tool。 */
export function create_ask_question_tool() {
  return tool({
    description:
      "Ask the user one or more questions when missing information would materially change the outcome. The call waits for every answer, then returns them so you can continue the same task. Do not use it for information that can be inferred safely.",
    inputSchema: ask_question_input_schema,
    execute: async (
      input: AskQuestionToolInput,
      execution_options: ToolExecutionOptions,
    ): Promise<AskQuestionToolOutput> => {
      const execution_context = execution_options.experimental_context as
        | Partial<SessionToolExecutionContext>
        | undefined;
      const turn_context = execution_context?.session_turn_context;
      const interaction_port = turn_context?.interactions;
      const turn_id = String(turn_context?.session.turn_id || "").trim();
      const tool_call_id = String(execution_options.toolCallId || "").trim();
      if (!interaction_port || !turn_id || !tool_call_id) {
        throw new Error(
          "ask_question requires an active Session tool execution context",
        );
      }

      const handle = await interaction_port.request({
        interaction_id: `interaction:${generate_id()}`,
        turn_id,
        kind: "question",
        source: {
          type: "tool",
          tool_call_id,
          tool_name: "ask_question",
        },
        title: input.title,
        questions: input.questions,
        created_at: Date.now(),
      });
      const result = await handle.result;
      if (result.status === "cancelled") {
        throw new Error(`ask_question was cancelled: ${result.reason}`);
      }
      if (result.status === "expired") {
        throw new Error("ask_question expired before the user responded");
      }
      if (result.response.kind !== "question") {
        throw new Error(
          "ask_question received an incompatible Interaction response",
        );
      }
      return {
        status: "resolved",
        answers: result.response.answers,
      };
    },
  });
}
