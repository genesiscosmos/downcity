/**
 * @file 验证 ask_question 对自己 Interaction 回答 payload 的解释。
 *
 * Interaction 核心只认信封，回答的形状与合法性由生产者负责，所以这些规则必须由
 * Tool 一侧守住。回归点：客户端曾把单选回答提交成数组，而核心当时用「不是多选就必须
 * 是字符串」拒收整次响应（`Session Interaction answer must be a string`）。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  read_ask_question_note,
  resolve_ask_question_answers,
} from "../bin/tools/ask/AskQuestionAnswers.js";

/** 构造一条已生成 question_id 的问题。 */
function create_question(overrides = {}) {
  return {
    question_id: "question-1",
    question: "需要部署到哪个区域？",
    type: "single_select",
    options: [
      { value: "cn", label: "中国" },
      { value: "us", label: "美国" },
    ],
    ...overrides,
  };
}

test("单选回答收到数组时收敛为首项，而不是让整次交互失败", () => {
  const answers = resolve_ask_question_answers(
    [create_question()],
    { answers: [{ question_id: "question-1", value: ["cn"] }] },
  );

  assert.deepEqual(answers, [{ question_id: "question-1", value: "cn" }]);
});

test("多选回答的形状保持为字符串数组", () => {
  const answers = resolve_ask_question_answers(
    [create_question({ type: "multi_select" })],
    { answers: [{ question_id: "question-1", value: ["cn", "us"] }] },
  );

  assert.deepEqual(answers, [{ question_id: "question-1", value: ["cn", "us"] }]);
});

test("多选回答收到字符串时收编为单元素数组", () => {
  const answers = resolve_ask_question_answers(
    [create_question({ type: "multi_select" })],
    { answers: [{ question_id: "question-1", value: "cn" }] },
  );

  assert.deepEqual(answers, [{ question_id: "question-1", value: ["cn"] }]);
});

test("文本回答保持字符串，即使问题带了候选项", () => {
  const answers = resolve_ask_question_answers(
    [create_question({ type: "text" })],
    { answers: [{ question_id: "question-1", value: "在上海部署" }] },
  );

  assert.deepEqual(answers, [{ question_id: "question-1", value: "在上海部署" }]);
});

test("回答顺序跟随提问顺序，而不是提交顺序", () => {
  const answers = resolve_ask_question_answers(
    [
      create_question({ question_id: "question-1" }),
      create_question({ question_id: "question-2" }),
    ],
    {
      answers: [
        { question_id: "question-2", value: "us" },
        { question_id: "question-1", value: "cn" },
      ],
    },
  );

  assert.deepEqual(answers, [
    { question_id: "question-1", value: "cn" },
    { question_id: "question-2", value: "us" },
  ]);
});

test("缺答、重复与越界选项都会抛出可读错误", () => {
  assert.throws(
    () => resolve_ask_question_answers([create_question()], { answers: [] }),
    /expected 1 answers but received 0/u,
  );
  assert.throws(
    () =>
      resolve_ask_question_answers([create_question()], {
        answers: [
          { question_id: "question-1", value: "cn" },
          { question_id: "question-1", value: "us" },
        ],
      }),
    /Duplicate ask_question answer/u,
  );
  assert.throws(
    () =>
      resolve_ask_question_answers([create_question()], {
        answers: [{ question_id: "question-1", value: "eu" }],
      }),
    /not a valid option/u,
  );
});

test("回答值不是字符串或字符串数组时抛出，不把对象当成答案", () => {
  assert.throws(
    () =>
      resolve_ask_question_answers([create_question({ type: "text" })], {
        answers: [{ question_id: "question-1", value: { text: "cn" } }],
      }),
    /must be a string or string array/u,
  );
});

test("payload 结构不可用时视为未提交回答", () => {
  assert.throws(
    () => resolve_ask_question_answers([create_question()], null),
    /expected 1 answers but received 0/u,
  );
});

test("补充说明只在非空字符串时透出", () => {
  assert.equal(read_ask_question_note({ answers: [], note: "已确认" }), "已确认");
  assert.equal(read_ask_question_note({ answers: [], note: "   " }), undefined);
  assert.equal(read_ask_question_note({ answers: [] }), undefined);
  assert.equal(read_ask_question_note(null), undefined);
});
