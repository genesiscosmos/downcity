/**
 * AIService 结构化决策（System One）能力回归测试。
 *
 * 覆盖模型类别推导、目录投影、请求校验与计量计费。
 */

import assert from "node:assert/strict"
import test from "node:test"
import { AIChannel, AIService } from "../bin/index.js"

function create_context(input) {
  return { input: { ...input }, locals: {}, db: {}, env: () => undefined }
}

class DecisionChannel extends AIChannel {
  constructor(questions_from_upstream) {
    super({ id: "system-one" })
    this.questions_from_upstream = questions_from_upstream
  }

  async decision(input) {
    this.received = input.input
    return {
      output: {
        answers: (this.questions_from_upstream ?? input.input.questions).map((question) => ({
          question_id: question.id,
          value: question.type === "boolean" ? true : question.type === "choice"
            ? question.options[0]
            : (question.min ?? 0) + 0.5,
          probability: 0.87,
          ...(question.type === "choice"
            ? { distribution: Object.fromEntries(question.options.map((option, index) => [option, index === 0 ? 0.87 : 0.13 / Math.max(1, question.options.length - 1)])) }
            : {}),
        })),
        usage: { input_tokens: 12, output_tokens: 0, total_tokens: 12 },
      },
    }
  }
}

test("决策模型推导出 decision 类别与模态", () => {
  const ai = new AIService()
  const channel = new DecisionChannel()
  ai.use(channel.model({ id: "jev", upstream_model: "typesafe/jev-1.13", name: "Jev" }))

  const [model] = AIService.listModels(ai, { env: () => undefined, identity: "user" })
  assert.equal(model.model_type, "decision")
  assert.deepEqual(model.modalities, ["decision"])
})

test("语言模型类别为 language，且不受新增规则影响", () => {
  const ai = new AIService()
  const channel = new (class extends AIChannel {
    async stream(input) {
      return { stream: new ReadableStream({ start(controller) { controller.close() } }) }
    }
  })({ id: "text" })
  ai.use(channel.model({ id: "text-model", upstream_model: "vendor", name: "Text" }))

  const [model] = AIService.listModels(ai, { env: () => undefined, identity: "user" })
  assert.equal(model.model_type, "language")
  assert.ok(model.modalities.includes("stream"))
})

test("没有可执行能力的模型在注册阶段被拒绝", () => {
  const ai = new AIService()
  assert.throws(() => ai.use({
    id: "empty",
    name: "Empty",
    runtime: { actions: {} },
  }), /has no executable capability/)
})

test("决策请求经过校验并送达 Channel", async () => {
  const ai = new AIService()
  const channel = new DecisionChannel()
  ai.use(channel.model({ id: "jev", upstream_model: "typesafe/jev-1.13", name: "Jev" }))

  const result = await ai.get("decision").run(create_context({
    model: "jev",
    state: { type: "text", text: "客户尝试连接 Stripe 三天未成功" },
    questions: [
      { id: "urgent", type: "boolean", instructions: "这条消息是否表达紧急" },
      { id: "risk", type: "score", instructions: "客户流失风险", min: 0, max: 10 },
    ],
  }))

  assert.equal(result.answers.length, 2)
  assert.equal(result.answers[0].value, true)
  assert.equal(result.answers[1].probability, 0.87)
  assert.equal(channel.received.questions.length, 2)
})

test("choice 类型答案带回概率分布", async () => {
  const ai = new AIService()
  ai.use(new DecisionChannel().model({ id: "jev", upstream_model: "typesafe/jev-1.13", name: "Jev" }))

  const result = await ai.get("decision").run(create_context({
    model: "jev",
    state: { type: "json", data: { days: 3 } },
    questions: [
      { id: "route", type: "choice", instructions: "应该路由到哪个队列", options: ["billing", "support"] },
    ],
  }))

  assert.equal(result.answers[0].value, "billing")
  assert.deepEqual(Object.keys(result.answers[0].distribution).sort(), ["billing", "support"])
})

test("非法决策请求返回 422 且不产生用量记录", async () => {
  const ai = new AIService()
  ai.use(new DecisionChannel().model({ id: "jev", upstream_model: "typesafe/jev-1.13", name: "Jev" }))

  const cases = [
    {
      name: "重复 question id",
      input: {
        model: "jev",
        state: { type: "text", text: "x" },
        questions: [
          { id: "q", type: "boolean", instructions: "a" },
          { id: "q", type: "boolean", instructions: "b" },
        ],
      },
    },
    {
      name: "choice 缺少 options",
      input: {
        model: "jev",
        state: { type: "text", text: "x" },
        questions: [{ id: "q", type: "choice", instructions: "a" }],
      },
    },
    {
      name: "choice 候选超过 255",
      input: {
        model: "jev",
        state: { type: "text", text: "x" },
        questions: [{
          id: "q",
          type: "choice",
          instructions: "a",
          options: Array.from({ length: 256 }, (_, index) => `option-${index}`),
        }],
      },
    },
    {
      name: "score 区间非法",
      input: {
        model: "jev",
        state: { type: "text", text: "x" },
        questions: [{ id: "q", type: "score", instructions: "a", min: 5, max: 1 }],
      },
    },
    {
      name: "boolean 声明了 options",
      input: {
        model: "jev",
        state: { type: "text", text: "x" },
        questions: [{ id: "q", type: "boolean", instructions: "a", options: ["yes"] }],
      },
    },
  ]

  for (const item of cases) {
    const ctx = create_context(item.input)
    await assert.rejects(
      () => ai.get("decision").run(ctx),
      (error) => error.statusCode === 422,
      item.name,
    )
    assert.equal(ctx.locals.ai_usage_id, undefined, `${item.name} 不应留下 usage_id`)
  }
})

test("答案未覆盖全部问题时拒绝上游结果", async () => {
  const ai = new AIService()
  // 上游只回答第一个问题，结果校验必须拦住这种不完整响应。
  ai.use(new DecisionChannel([{ id: "q1", type: "boolean", instructions: "a" }])
    .model({ id: "jev", upstream_model: "typesafe/jev-1.13", name: "Jev" }))

  // 结果校验位于执行期，失败与其它 modality 一致，返回 422 响应而非抛出。
  const response = await ai.get("decision").run(create_context({
    model: "jev",
    state: { type: "text", text: "x" },
    questions: [
      { id: "q1", type: "boolean", instructions: "a" },
      { id: "q2", type: "boolean", instructions: "b" },
    ],
  }))
  assert.equal(response.status, 422)
})
