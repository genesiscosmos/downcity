/**
 * ask_question Tool 的输入与输出协议。
 *
 * 问题字段与 canonical Interaction 保持一致，只少一个由 Session 生成的 `question_id`；
 * 模型写的形状就是落库与渲染的形状。Interaction 标识、Turn 标识与生命周期状态由 Session
 * 运行时维护，不交给模型生成。
 */

import type {
  SessionInteractionAnswer,
  SessionInteractionQuestion,
} from "@downcity/type";

/** 模型调用 ask_question 时提交的一条问题；`question_id` 由 Session 生成，不由模型提供。 */
export type AskQuestionsToolQuestion = Omit<
  SessionInteractionQuestion,
  "question_id"
>;

/** 模型调用 ask_question 时提交的结构化输入。 */
export interface AskQuestionsToolInput {
  /** 问题卡片向用户展示的简短标题。 */
  title: string;
  /** 本次需要用户完整回答的一到多条问题。 */
  questions: AskQuestionsToolQuestion[];
}

/** 用户完成回答后返回给模型的结构化 Tool Result。 */
export interface AskQuestionsToolOutput {
  /** 当前提问已由用户完整回答。 */
  status: "resolved";
  /** 按 question_id 关联的完整回答集合，顺序与提问一致。 */
  answers: SessionInteractionAnswer[];
  /** 用户随回答提交的可选补充说明。 */
  note?: string;
}
