/**
 * 决策模型请求与结果校验模块。
 *
 * 决策协议是闭合且带类型的（问题有类型、选项有候选、评分有区间），因此在进入
 * Channel 之前必须在服务端校验，避免把非法形状透传给上游。校验只描述协议边界，
 * 不拥有路由、执行或计费策略。
 */

import type { ModelJsonValue } from "@downcity/type";
import { httpError } from "../../utils/helpers.js";
import type {
  AIDecisionAnswer,
  AIDecisionQuestion,
  AIDecisionRequest,
  AIDecisionResult,
  AIDecisionState,
} from "../../types/AI.js";

/** choice 类型允许的最大候选数，来自上游 cardinality 约束。 */
const MAX_CHOICE_OPTIONS = 255;
/** score 类型未声明区间时使用的默认下界。 */
const DEFAULT_SCORE_MIN = 0;
/** score 类型未声明区间时使用的默认上界。 */
const DEFAULT_SCORE_MAX = 1;

/**
 * 校验决策请求，并返回归一化后的请求。
 *
 * 非法形状统一以 422 失败；调用方必须在创建 usage 记录之前调用本函数。
 */
export function validate_ai_decision_request(input: unknown): AIDecisionRequest {
  const record = require_record(input, "decision request");
  const state = validate_state(record.state);
  const questions = validate_questions(record.questions);
  return { state, questions };
}

/** 校验决策结果，确保答案完整覆盖问题且取值符合问题类型。 */
export function validate_ai_decision_result(
  value: unknown,
  request: AIDecisionRequest,
): AIDecisionResult {
  const record = require_record(value, "decision result");
  if (!Array.isArray(record.answers)) {
    throw decision_error("decision result answers must be an array");
  }
  const questions = new Map(request.questions.map((question) => [question.id, question]));
  if (record.answers.length !== questions.size) {
    throw decision_error("decision result must answer every question exactly once");
  }

  const seen = new Set<string>();
  const answers = record.answers.map((answer) => {
    const parsed = validate_answer(answer, questions);
    if (seen.has(parsed.question_id)) {
      throw decision_error(`decision result contains duplicate answer: ${parsed.question_id}`);
    }
    seen.add(parsed.question_id);
    return parsed;
  });

  const usage = record.usage;
  return usage === undefined ? { answers } : { answers, usage: usage as AIDecisionResult["usage"] };
}

/** 校验输入状态。 */
function validate_state(value: unknown): AIDecisionState {
  const record = require_record(value, "decision state");
  if (record.type === "text") {
    const text = read_non_empty_string(record.text, "decision state text");
    return { type: "text", text };
  }
  if (record.type === "json") {
    if (!is_json_value(record.data)) {
      throw decision_error("decision state data must be a JSON value");
    }
    return { type: "json", data: record.data as ModelJsonValue };
  }
  throw decision_error("decision state type must be text or json");
}

/** 校验问题列表，并返回归一化后的问题。 */
function validate_questions(value: unknown): AIDecisionQuestion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw decision_error("decision questions must be a non-empty array");
  }
  const ids = new Set<string>();
  return value.map((item) => {
    const question = validate_question(item);
    if (ids.has(question.id)) {
      throw decision_error(`duplicate decision question id: ${question.id}`);
    }
    ids.add(question.id);
    return question;
  });
}

/** 校验单个问题。 */
function validate_question(value: unknown): AIDecisionQuestion {
  const record = require_record(value, "decision question");
  const id = read_non_empty_string(record.id, "decision question id");
  const instructions = read_non_empty_string(record.instructions, "decision question instructions");
  const type = record.type;

  if (type === "boolean") {
    reject_present(record, ["options", "min", "max"], `question ${id}`);
    return { id, type, instructions };
  }

  if (type === "choice") {
    reject_present(record, ["min", "max"], `question ${id}`);
    return { id, type, instructions, options: validate_options(record.options, id) };
  }

  if (type === "score") {
    reject_present(record, ["options"], `question ${id}`);
    const min = read_optional_number(record.min) ?? DEFAULT_SCORE_MIN;
    const max = read_optional_number(record.max) ?? DEFAULT_SCORE_MAX;
    if (!(min < max)) {
      throw decision_error(`question ${id} score range must satisfy min < max`);
    }
    return { id, type, instructions, min, max };
  }

  throw decision_error(`question ${id} type must be boolean, choice or score`);
}

/** 校验 choice 候选取值。 */
function validate_options(value: unknown, question_id: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw decision_error(`question ${question_id} choice options must be a non-empty array`);
  }
  if (value.length > MAX_CHOICE_OPTIONS) {
    throw decision_error(
      `question ${question_id} choice options must not exceed ${MAX_CHOICE_OPTIONS} entries`,
    );
  }
  const options = value.map((item) => read_non_empty_string(item, `question ${question_id} option`));
  if (new Set(options).size !== options.length) {
    throw decision_error(`question ${question_id} choice options must be unique`);
  }
  return options;
}

/** 校验单个答案。 */
function validate_answer(
  value: unknown,
  questions: Map<string, AIDecisionQuestion>,
): AIDecisionAnswer {
  const record = require_record(value, "decision answer");
  const question_id = read_non_empty_string(record.question_id, "decision answer question_id");
  const question = questions.get(question_id);
  if (!question) {
    throw decision_error(`decision answer references unknown question: ${question_id}`);
  }
  const answer: AIDecisionAnswer = {
    question_id,
    value: validate_answer_value(record.value, question),
  };
  const probability = read_optional_number(record.probability);
  if (probability !== undefined) {
    if (probability < 0 || probability > 1) {
      throw decision_error(`answer ${question_id} probability must be between 0 and 1`);
    }
    answer.probability = probability;
  }
  if (record.distribution !== undefined) {
    answer.distribution = validate_distribution(record.distribution, question);
  }
  return answer;
}

/** 校验答案取值与问题类型一致。 */
function validate_answer_value(value: unknown, question: AIDecisionQuestion): boolean | string | number {
  if (question.type === "boolean") {
    if (typeof value !== "boolean") {
      throw decision_error(`answer ${question.id} must be a boolean`);
    }
    return value;
  }
  if (question.type === "choice") {
    if (typeof value !== "string" || !question.options?.includes(value)) {
      throw decision_error(`answer ${question.id} must be one of its choice options`);
    }
    return value;
  }
  const number = read_optional_number(value);
  if (number === undefined || number < (question.min ?? DEFAULT_SCORE_MIN) || number > (question.max ?? DEFAULT_SCORE_MAX)) {
    throw decision_error(`answer ${question.id} must be a number within its score range`);
  }
  return number;
}

/** 校验 choice 概率分布的键落在候选内。 */
function validate_distribution(
  value: unknown,
  question: AIDecisionQuestion,
): Record<string, number> {
  if (question.type !== "choice") {
    throw decision_error(`answer ${question.id} distribution is only supported for choice questions`);
  }
  const record = require_record(value, `answer ${question.id} distribution`);
  const distribution: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!question.options?.includes(key)) {
      throw decision_error(`answer ${question.id} distribution contains unknown option: ${key}`);
    }
    const probability = read_optional_number(entry);
    if (probability === undefined || probability < 0) {
      throw decision_error(`answer ${question.id} distribution values must be non-negative numbers`);
    }
    distribution[key] = probability;
  }
  return distribution;
}

/** 确认一个值不是普通对象时抛出协议错误。 */
function require_record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw decision_error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** 读取非空白字符串。 */
function read_non_empty_string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw decision_error(`${label} must be a non-empty string`);
  }
  return value;
}

/** 读取有限数字。 */
function read_optional_number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 确认字段未被使用。 */
function reject_present(record: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of keys) {
    if (record[key] !== undefined) {
      throw decision_error(`${label} must not declare ${key}`);
    }
  }
}

/** 递归确认一个值是合法 JSON 值。 */
function is_json_value(value: unknown): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "boolean") return true;
  if (type === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(is_json_value);
  if (type === "object") {
    return Object.values(value as Record<string, unknown>).every(is_json_value);
  }
  return false;
}

/** 构造统一的决策协议错误。 */
function decision_error(message: string): Error {
  return httpError(422, message);
}
