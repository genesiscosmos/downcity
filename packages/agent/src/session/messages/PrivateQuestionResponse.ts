/**
 * 私密 Question Interaction 的请求与提交校验。
 *
 * 用户明文只在受信提交路径解释；持久化响应仅包含 `${secrets.name}`。
 * 普通问答的选项与完整性校验沿用原有答案解释器，不向错误信息回显私密字段。
 */

import type {
  JsonValue,
  SessionInteractionAnswer,
  SessionInteractionQuestion,
  SessionInteractionRequest,
  SessionInteractionResponse,
} from "@downcity/type";
import { resolve_ask_question_answers } from "@/tools/ask/AskQuestionAnswers.js";
import { secret_reference } from "./SessionSecrets.js";

/** 从 question 请求提取问题；其他业务类型保持不透明。 */
export function interaction_questions(request: SessionInteractionRequest): SessionInteractionQuestion[] {
  if (request.type !== "question" || !request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) return [];
  const questions = request.payload.questions;
  return Array.isArray(questions) ? questions as unknown as SessionInteractionQuestion[] : [];
}

/** 校验私密问题名称和重复定义；在向用户发布请求之前执行。 */
export function validate_private_questions(request: SessionInteractionRequest): void {
  const names = new Set<string>();
  for (const question of interaction_questions(request)) {
    if (question.type !== "secret") continue;
    if (typeof question.name !== "string") throw new Error("A private question requires a Session variable name");
    if (question.options !== undefined) throw new Error("A private question cannot contain public choices");
    secret_reference(question.name);
    if (names.has(question.name)) throw new Error("Private questions must use distinct variable names");
    names.add(question.name);
  }
}

/** 受信提交的完整非敏感响应和待写入内存的值。 */
export interface PreparedPrivateQuestionResponse {
  /** 含引用的安全响应；允许进入 canonical Message。 */
  readonly response: SessionInteractionResponse;
  /** 只交给 Session 私密内存的值；不记录或序列化。 */
  readonly secrets: ReadonlyMap<string, string>;
}

/** 校验完整回答并移除私密值；不修改 Session 或持久化数据。 */
export function prepare_private_question_response(
  request: SessionInteractionRequest,
  response: SessionInteractionResponse,
): PreparedPrivateQuestionResponse {
  const questions = interaction_questions(request);
  if (!questions.some((question) => question.type === "secret")) throw new Error("This Interaction does not request private input");
  if (response.type !== "question" || response.outcome !== "resolved") throw new Error("Private input requires a resolved question response");
  const payload = response.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.answers)) throw new Error("Private question answers are required");
  const raw_answers = payload.answers;
  if (payload.note !== undefined) throw new Error("Private question forms do not accept a public note");
  // 严格检查原始项，避免普通回答解释器的容错行为丢弃携带敏感值的未知字段。
  for (const answer of raw_answers) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)
      || Object.keys(answer).some((key) => key !== "question_id" && key !== "value")) {
      throw new Error("Invalid private question answer");
    }
  }
  let answers: SessionInteractionAnswer[];
  try {
    answers = resolve_ask_question_answers(questions, payload);
  } catch {
    throw new Error("Private question answers are incomplete or invalid");
  }
  const question_by_id = new Map(questions.map((question) => [question.question_id, question]));
  const secrets = new Map<string, string>();
  const safe_answers = answers.map((answer) => {
    const question = question_by_id.get(answer.question_id);
    if (question?.type !== "secret") return answer;
    const raw = raw_answers.find((item) => item && typeof item === "object" && !Array.isArray(item) && item.question_id === answer.question_id);
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.value !== "string" || !raw.value || !question.name) {
      throw new Error("A private question requires a non-empty text answer");
    }
    secrets.set(question.name, raw.value);
    return { question_id: answer.question_id, value: secret_reference(question.name) };
  });
  return {
    response: { type: "question", outcome: "resolved", payload: { answers: safe_answers } as unknown as JsonValue },
    secrets,
  };
}
