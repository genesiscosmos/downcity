/**
 * AIService 模型上下文窗口协议测试。
 *
 * 覆盖 AIChannel 配置透传、模型目录公开与注册阶段的非法值校验。
 */

import assert from "node:assert/strict"
import test from "node:test"

import {
  AIService,
  AIChannel,
} from "../bin/index.js"

test("AIService exposes AIChannel model context_window in the public catalog", () => {
  const channel = new (class extends AIChannel {})({ id: "catalog" })
  const ai = new AIService()

  ai.use(channel.model({
    id: "large-context-model",
    upstream_model: "large-context-model",
    name: "Large Context Model",
    context_window: 256000,
    price: ["输入：1 credit / 1K tokens", "输出：3 credits / 1K tokens"],
  }))

  const catalog = AIService.listModels(ai, {
    env: () => undefined,
    identity: "user",
  })

  assert.equal(catalog[0].context_window, 256000)
  assert.deepEqual(catalog[0].price, ["输入：1 credit / 1K tokens", "输出：3 credits / 1K tokens"])
})

test("AIService rejects invalid model context_window values", () => {
  for (const context_window of [0, -1, 1.5, Number.NaN]) {
    const ai = new AIService()
    assert.throws(() => ai.use({
      id: `invalid-context-${String(context_window)}`,
      name: "Invalid Context Model",
      context_window,
      runtime: {
        actions: {},
      },
    }), /context_window must be a positive safe integer/)
  }
})
