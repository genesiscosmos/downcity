/**
 * ask_question Tool 的输入与输出协议。
 *
 * 该协议只描述模型发起问题和收到回答时可见的数据；Interaction 标识、Turn 标识与
 * 生命周期状态由 Session 运行时维护，不交给模型生成。
 */

import type {
  SessionInteractionAnswer,
  SessionInteractionOption,
  SessionInteractionQuestion,
} from "@/types/session/SessionInteraction.js";

/** 模型调用 ask_question 时提交的一条问题。 */
export interface AskQuestionsToolQuestion {
  /** 向用户展示的完整问题文本。 */
  question: string;
  /** 当前问题要求的回答形式，所有问题都必须显式提供。 */
  type: SessionInteractionQuestion["response_type"];
  /** 单选或多选问题允许选择的候选项。 */
  options?: SessionInteractionOption[];
}

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
  /** 按 question_id 关联的完整回答集合。 */
  answers: SessionInteractionAnswer[];
}
