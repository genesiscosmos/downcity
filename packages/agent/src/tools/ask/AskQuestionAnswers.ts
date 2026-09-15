/**
 * ask_question 对自己 Interaction payload 的解释。
 *
 * Interaction 只有通用信封，`payload` 由生产者解释，所以「回答是否完整、选项是否合法」
 * 归本模块，而不是 Session 核心。
 *
 * 回答形状在这里按问题自身的 `type` 收敛：多选是字符串数组，其余是字符串。客户端
 * 提交了另一种形状也能被收编（单选来了数组就取首项），而不是让整次交互失败；内容
 * 仍然严格校验，缺答、重复、越界选项都会抛出可读错误。
 */

import type {
  SessionInteractionAnswer,
  SessionInteractionQuestion,
} from "@downcity/type";

/**
 * 把用户提交的回答解释为规范答案集合。
 *
 * 返回顺序与 `questions` 一致，值形状与 `type` 一致，可直接作为 Tool Result 交给模型。
 */
export function resolve_ask_question_answers(
  questions: readonly SessionInteractionQuestion[],
  payload: unknown,
): SessionInteractionAnswer[] {
  const submitted = new Map<string, unknown>();
  for (const raw of read_raw_answers(payload)) {
    const question_id = String(raw.question_id || "").trim();
    if (!question_id) {
      throw new Error("ask_question answer requires question_id");
    }
    if (submitted.has(question_id)) {
      throw new Error(`Duplicate ask_question answer: ${question_id}`);
    }
    submitted.set(question_id, raw.value);
  }
  if (submitted.size !== questions.length) {
    throw new Error(
      `ask_question expected ${questions.length} answers but received ${submitted.size}`,
    );
  }
  return questions.map((question) => {
    if (!submitted.has(question.question_id)) {
      throw new Error(`ask_question answer is missing: ${question.question_id}`);
    }
    const value = normalize_answer_value(question, submitted.get(question.question_id));
    assert_answer_options(question, value);
    return { question_id: question.question_id, value };
  });
}

/** 从回答 payload 中读取可选的补充说明。 */
export function read_ask_question_note(payload: unknown): string | undefined {
  if (!is_record(payload)) return undefined;
  const note = payload.note;
  return typeof note === "string" && note.trim() ? note : undefined;
}

/** 读取 payload 中已提交的原始回答条目；结构不可用时视为未提交。 */
function read_raw_answers(
  payload: unknown,
): Array<{ question_id?: unknown; value?: unknown }> {
  if (!is_record(payload) || !Array.isArray(payload.answers)) return [];
  return payload.answers.filter(is_record);
}

/**
 * 把回答值收敛到问题要求的形状。
 *
 * 多选始终是数组，其余始终是字符串。值本身不是字符串（或字符串数组）时抛出，
 * 避免把 `[object Object]` 这类内容当成用户答案交给模型。
 */
function normalize_answer_value(
  question: SessionInteractionQuestion,
  value: unknown,
): string | string[] {
  if (question.type === "multi_select") {
    if (Array.isArray(value)) {
      return value.map((item) => require_answer_string(question, item));
    }
    // 未选择任何候选项：保持空数组，由选项校验决定是否可接受。
    if (value === undefined || value === null) return [];
    return [require_answer_string(question, value)];
  }
  if (Array.isArray(value)) {
    // 单选题误传数组时取首项收编，而不是让整次交互失败。
    return value.length > 0 ? require_answer_string(question, value[0]) : "";
  }
  if (value === undefined || value === null) return "";
  return require_answer_string(question, value);
}

/** 选择题的回答必须落在候选项内。 */
function assert_answer_options(
  question: SessionInteractionQuestion,
  value: string | string[],
): void {
  if (question.type === "text") return;
  const allowed = new Set((question.options ?? []).map((option) => option.value));
  const selected = Array.isArray(value) ? value : [value];
  const invalid = selected.find((item) => !allowed.has(item));
  if (invalid !== undefined) {
    throw new Error(
      `ask_question answer is not a valid option: ${question.question_id} -> ${invalid}`,
    );
  }
}

/** 读取单个回答值，非字符串一律拒绝。 */
function require_answer_string(
  question: SessionInteractionQuestion,
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new Error(
      `ask_question answer must be a string or string array: ${question.question_id}`,
    );
  }
  return value;
}

/** 判断一个未知值是否为普通对象。 */
function is_record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
