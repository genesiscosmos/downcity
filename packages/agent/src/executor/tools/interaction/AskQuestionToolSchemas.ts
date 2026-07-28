/**
 * ask_question Tool 输入 Schema。
 *
 * 关键点（中文）：文本问题不接受候选项；单选和多选问题必须提供至少一个候选项，
 * 从模型输入边界消除无法渲染或无法校验的 Question Interaction。
 */

import { z } from "zod";

const option_schema = z
  .object({
    value: z.string().trim().min(1)
      .describe("Stable option value returned in the answer."),
    label: z.string().trim().min(1).describe("User-visible option label."),
    description: z.string().trim().min(1).optional()
      .describe("Optional explanation of this option."),
  })
  .strict();

const text_question_schema = z
  .object({
    question_id: z.string().trim().min(1)
      .describe("Stable question identifier unique within this request."),
    prompt: z.string().trim().min(1)
      .describe("Complete question shown to the user."),
    response_type: z.literal("text"),
  })
  .strict();

const select_question_schema = z
  .object({
    question_id: z.string().trim().min(1)
      .describe("Stable question identifier unique within this request."),
    prompt: z.string().trim().min(1)
      .describe("Complete question shown to the user."),
    response_type: z.enum(["single_select", "multi_select"]),
    options: z.array(option_schema).min(1)
      .describe("Allowed values presented to the user."),
  })
  .strict();

/** ask_question Tool 的运行时输入校验 Schema。 */
export const ask_question_input_schema = z
  .object({
    title: z.string().trim().min(1)
      .describe("Short title for the question card."),
    questions: z
      .array(z.discriminatedUnion("response_type", [
        text_question_schema,
        select_question_schema,
      ]))
      .min(1)
      .describe("Questions that all require an answer before execution resumes."),
  })
  .strict();
